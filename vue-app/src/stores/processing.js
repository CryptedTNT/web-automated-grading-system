/* ============================================================
   stores/processing.js — state of the current processing job

   The original kept this in a module-level `state` object inside the
   Processing IIFE, which survived page switches because the page was
   never really unmounted. A Vue view *is* unmounted on navigation, so
   the job state lives in a store instead — that way a teacher can
   open Results mid-run and come back to an intact log.
   ============================================================ */

import { defineStore } from 'pinia'
import { API } from '@/services/api.js'
import { useAppStore } from './app.js'
import { showMessage } from '@/services/dialog.js'
import { sessionLabel, nextSessionNumber, refreshSessionNumbers } from '@/services/sessionNumbers.js'

/* Not part of state: it holds a promise, and nothing renders it. */
let runningPromise = null
/* Also not part of state, same reason -- the controller for whichever
   upload request is currently in flight, so cancel() can abort it
   directly instead of only setting a flag the loop can't check until
   that request already resolves. */
let currentAbortController = null

const STATUS_LABELS = {
  idle: 'Ready',
  running: 'Grading',
  completed: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
}
const STATUS_BADGES = {
  idle: 'badge-gray',
  running: 'badge-warning',
  completed: 'badge-success',
  error: 'badge-danger',
  cancelled: 'badge-gray',
}

export const useProcessingStore = defineStore('processing', {
  state: () => ({
    status: 'idle',
    progress: 0,
    completed: 0,
    total: 0,
    currentFile: '',
    logs: [],
    sessionId: null,
    error: '',
    /* Set by cancel(); the adapter reads it between groups (students). */
    cancelRequested: false,
    /* Identifies the queue a finished run belongs to, so a new batch
       resets the panel instead of showing the previous session. */
    sourceSignature: '',
  }),

  getters: {
    isRunning: (state) => state.status === 'running',
    statusLabel: (state) => STATUS_LABELS[state.status] || STATUS_LABELS.idle,
    statusBadgeClass: (state) => STATUS_BADGES[state.status] || STATUS_BADGES.idle,
    startButtonLabel: (state) =>
      ({
        running: state.cancelRequested ? 'Cancelling...' : 'Grading...',
        completed: 'Completed',
        error: 'Retry Grading',
        cancelled: 'Restart Grading',
      })[state.status] || 'Start Grading',
  },

  actions: {
    appendLog(message, level = 'info') {
      this.logs.push({
        message: String(message || ''),
        level,
        time: new Date().toLocaleTimeString(),
      })
      if (this.logs.length > 200) this.logs.shift()
    },

    /* Called when the page opens: if the upload queue or answer key
       changed since the last run, start from a clean panel. */
    syncQueue() {
      const app = useAppStore()
      const groups = app.uploadFiles
      if (this.status === 'running' || !groups.length) return

      const signature = queueSignature(app.selectedAnswerKeyId, groups)
      if (signature === this.sourceSignature) return

      this.$reset()
      this.total = groups.length
      this.sourceSignature = signature
    },

    /* Aborts whichever submission is currently uploading/grading right
       now, rather than waiting for it to finish before the loop notices
       cancelRequested -- on a slow (CPU-only) deployment that request
       can take a minute or more, which is what made Cancel look stuck.
       The server discards the entire cancelled run, including any earlier
       completed submissions, so it cannot appear as a partial report. */
    cancel() {
      if (this.status !== 'running' || this.cancelRequested) return
      this.cancelRequested = true
      currentAbortController?.abort()
      this.appendLog('Cancelling...', 'error')
    },

    async start() {
      if (runningPromise) return runningPromise

      const app = useAppStore()
      const groups = [...app.uploadFiles]
      const keyId = parseInt(app.selectedAnswerKeyId) || null

      if (!groups.length) {
        await showMessage('Images Required', 'Return to Upload and add at least one answer sheet image.')
        return null
      }
      if (!app.consentConfirmed) {
        await showMessage(
          'Consent Confirmation Required',
          'Return to Upload and confirm that consent was collected for every student in this queue.',
        )
        return null
      }
      if (!keyId) {
        await showMessage('Answer Key Required', 'Select an answer key before processing.')
        return null
      }
      const answerKeyItems = await API.answerKeyItems(keyId)
      if (!answerKeyItems.length) {
        await showMessage('Answer Key Is Empty', 'The selected answer key must contain at least one valid item.')
        return null
      }

      this.$reset()
      this.status = 'running'
      this.total = groups.length
      this.sourceSignature = queueSignature(keyId, groups)
      this.appendLog('Starting grading.')

      runningPromise = this._run(groups, keyId)
      try {
        return await runningPromise
      } finally {
        runningPromise = null
      }
    },

    /* Each group (one student's whole submission, one or more pages) is
       its own request to POST /sessions/<id>/sheets -- that call blocks
       until the real YOLO+TrOCR grading for that submission has
       committed server-side, so looping group-by-group (rather than
       one batched request for the whole queue) is what lets this
       progress bar/log reflect real per-student completions instead of
       a single all-or-nothing wait. */
    async _run(groups, keyId) {
      let sessionId = null
      const app = useAppStore()
      let failedCount = 0

      try {
        sessionId = await API.createSession(keyId, sourceLabel(groups))
        this.sessionId = sessionId
        app.currentSessionId = sessionId
        await refreshSessionNumbers() // the new run shows the number it gets IF it finishes (see sessionNumbers.js)
        this.appendLog(`${sessionLabel(sessionId)} created with ${groups.length} student submission(s).`)

        for (let index = 0; index < groups.length; index += 1) {
          if (this.cancelRequested) {
            this.appendLog(`Cancelled after ${index} of ${groups.length} submission(s).`, 'error')
            break
          }
          const group = groups[index]
          this.currentFile = group?.label || group?.pages?.[0]?.name || 'answer-sheet'
          const pageWord = group.pages.length === 1 ? '1 page' : `${group.pages.length} pages`
          this.appendLog(`[${index + 1}/${groups.length}] Uploading and grading ${this.currentFile} (${pageWord}).`)

          // One student's upload failing here used to throw straight
          // out to the catch below, marking the WHOLE session "Failed"
          // and abandoning every remaining student in what could be a
          // 50-submission batch -- a single oversized photo or transient
          // network blip on submission #10 shouldn't cost #11-50 too.
          // Logging it and moving on keeps the rest of the run's progress.
          currentAbortController = new AbortController()
          try {
            const uploaded = await API.uploadSheetGroup(
              sessionId,
              group.pages.map((entry) => entry.file),
              app.consentConfirmed,
              currentAbortController.signal,
            )
            if (uploaded?.cancelled) {
              // The server stopped grading this submission and discarded it
              // (the session was cancelled from elsewhere) -- not "graded".
              this.appendLog(`[${index + 1}/${groups.length}] ${this.currentFile} cancelled.`, 'error')
              break
            }
            this.appendLog(`[${index + 1}/${groups.length}] ${this.currentFile} graded.`, 'success')
          } catch (error) {
            if (error.name === 'AbortError') {
              // cancel() already set cancelRequested and logged "Cancelling...";
              // the request stops waiting immediately. The PATCH to
              // 'Cancelled' right after this loop is what tells the server
              // to stop grading the sheet it is on (at its next checkpoint,
              // within about one recognition) and discard it, rather than
              // keep the CPU busy for minutes on a sheet nobody wants.
              this.appendLog(
                `[${index + 1}/${groups.length}] ${this.currentFile} cancelled.`,
                'error',
              )
              break
            }
            failedCount += 1
            this.appendLog(
              `[${index + 1}/${groups.length}] ${this.currentFile} failed to upload: ${error.message || error}`,
              'error',
            )
          } finally {
            currentAbortController = null
          }

          this.completed = index + 1
          this.progress = Math.round((this.completed / groups.length) * 100)
        }

        if (this.cancelRequested) {
          await API.updateSessionStatus(sessionId, 'Cancelled')
          await refreshSessionNumbers()
          this.status = 'cancelled'
          this.currentFile = ''
          this.sessionId = null
          app.currentSessionId = null
          /* The queue is left intact so the run can simply be restarted. */
          this.appendLog(
            `Run cancelled and discarded. The next completed run is still Session #${nextSessionNumber()}.`,
            'error',
          )
          return null
        }

        /* A run in which nothing could be graded did not finish
           successfully, so it must not count as a session (and use up
           a number) either. The queue is kept so it can be retried. */
        if (failedCount === groups.length) {
          await API.updateSessionStatus(sessionId, 'Failed')
          await refreshSessionNumbers()
          this.status = 'error'
          this.error = 'None of the submissions could be graded, so this run does not count as a session. See the log for why, then retry.'
          this.currentFile = ''
          this.appendLog(`Run failed: none of the ${groups.length} submission(s) could be graded.`, 'error')
          return null
        }

        await API.updateSessionStatus(sessionId, 'Completed')
        await refreshSessionNumbers()
        this.status = 'completed'
        this.progress = 100
        this.completed = this.total
        this.currentFile = ''
        /* The queue is consumed; clearing it stops a second click from
           creating duplicate records for the same images. */
        app.uploadFiles = []
        this.appendLog(
          failedCount
            ? `${sessionLabel(sessionId)} completed with ${failedCount} of ${groups.length} submission(s) that failed to upload -- see the log above for which. Open Results to review what graded successfully.`
            : `${sessionLabel(sessionId)} completed. Open Results to continue.`,
          failedCount ? 'error' : 'success',
        )
        return sessionId
      } catch (error) {
        if (sessionId) {
          await API.updateSessionStatus(sessionId, 'Failed')
          await refreshSessionNumbers()
        }
        this.status = 'error'
        this.error = error.message || 'The processing job failed.'
        this.currentFile = ''
        return null
      }
    },
  },
})

function queueSignature(answerKeyId, groups) {
  const entries = groups.map((group) =>
    group.pages.map((entry) => entry.key || `${entry.name}|${entry.size}|${entry.lastModified}`).join('+'),
  )
  return `${answerKeyId || 'no-key'}::${entries.join('::')}`
}

function sourceLabel(groups) {
  const sources = new Set(groups.map((group) => group.source))
  if (sources.has('Camera')) return 'Live Capture'
  if (sources.has('Folder')) return 'Web Folder Upload'
  return 'Web Image Upload'
}
