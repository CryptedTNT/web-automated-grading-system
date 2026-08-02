/* ============================================================
   stores/processing.js — state of the current processing job

   The original kept this in a module-level `state` object inside the
   Processing IIFE, which survived page switches because the page was
   never really unmounted. A Vue view *is* unmounted on navigation, so
   the job state lives in a store instead — that way a teacher can
   open Results mid-run and come back to an intact log.
   ============================================================ */

import { defineStore } from 'pinia'
import { DB } from '@/services/database.js'
import { runProcessingJob } from '@/services/processing.js'
import { useAppStore } from './app.js'
import { showMessage } from '@/services/dialog.js'

/* Not part of state: it holds a promise, and nothing renders it. */
let runningPromise = null

const STATUS_LABELS = {
  idle: 'Ready',
  running: 'Processing',
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
    /* Set by cancel(); the adapter reads it between files. */
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
        running: state.cancelRequested ? 'Cancelling...' : 'Processing...',
        completed: 'Completed',
        error: 'Retry Processing',
        cancelled: 'Restart Processing',
      })[state.status] || 'Start Processing',
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
      const files = app.uploadFiles
      if (this.status === 'running' || !files.length) return

      const signature = queueSignature(app.selectedAnswerKeyId, files)
      if (signature === this.sourceSignature) return

      this.$reset()
      this.total = files.length
      this.sourceSignature = signature
    },

    /* Asks the adapter to stop after the file it is on. Records already
       written stay — the session is marked Cancelled, not deleted, so a
       teacher can still open the partial results. */
    cancel() {
      if (this.status !== 'running' || this.cancelRequested) return
      this.cancelRequested = true
      this.appendLog('Cancelling after the current image...', 'error')
    },

    async start() {
      if (runningPromise) return runningPromise

      const app = useAppStore()
      const files = [...app.uploadFiles]
      const keyId = parseInt(app.selectedAnswerKeyId) || null

      if (!files.length) {
        await showMessage('Images Required', 'Return to Upload and add at least one answer sheet image.')
        return null
      }
      if (!keyId) {
        await showMessage('Answer Key Required', 'Select an answer key before processing.')
        return null
      }
      const answerKeyItems = DB.answerKeyItems(keyId)
      if (!answerKeyItems.length) {
        await showMessage('Answer Key Is Empty', 'The selected answer key must contain at least one valid item.')
        return null
      }

      this.$reset()
      this.status = 'running'
      this.total = files.length
      this.sourceSignature = queueSignature(keyId, files)
      this.appendLog('Starting the model-pending processing adapter.')

      runningPromise = this._run(files, keyId, answerKeyItems)
      try {
        return await runningPromise
      } finally {
        runningPromise = null
      }
    },

    async _run(files, keyId, answerKeyItems) {
      let sessionId = null
      const app = useAppStore()

      try {
        sessionId = DB.createSession(keyId, sourceLabel(files))
        this.sessionId = sessionId
        app.currentSessionId = sessionId
        this.appendLog(`Session #${sessionId} created with ${files.length} image(s).`)

        await runProcessingJob(files, answerKeyItems, {
          onFileStart: ({ index, total, file }) => {
            this.currentFile = file?.name || file?.file?.name || 'answer-sheet'
            this.appendLog(`[${index + 1}/${total}] Starting ${this.currentFile}.`)
          },
          onProgress: ({ completed, percent }) => {
            this.completed = completed
            this.progress = percent
          },
          onLog: ({ message, level }) => this.appendLog(message, level),
          onFileComplete: ({ result }) => persistResult(sessionId, result),
          shouldCancel: () => this.cancelRequested,
          onCancel: ({ completed, total }) =>
            this.appendLog(`Cancelled after ${completed} of ${total} file(s).`, 'error'),
          onComplete: ({ total }) => this.appendLog(`All ${total} placeholder record(s) were saved.`, 'success'),
          onError: ({ error, completed, total }) =>
            this.appendLog(
              `Processing stopped after ${completed} of ${total} files: ${error.message}`,
              'error',
            ),
        })

        if (this.cancelRequested) {
          DB.updateSessionStatus(sessionId, 'Cancelled')
          this.status = 'cancelled'
          this.currentFile = ''
          /* The queue is left intact so the run can simply be restarted. */
          this.appendLog(
            `Session #${sessionId} cancelled. Records created so far were kept.`,
            'error',
          )
          return sessionId
        }

        DB.updateSessionStatus(sessionId, 'Completed')
        this.status = 'completed'
        this.progress = 100
        this.completed = this.total
        this.currentFile = ''
        /* The queue is consumed; clearing it stops a second click from
           creating duplicate records for the same images. */
        app.uploadFiles = []
        this.appendLog(`Session #${sessionId} completed. Open Results to continue.`, 'success')
        return sessionId
      } catch (error) {
        if (sessionId) DB.updateSessionStatus(sessionId, 'Failed')
        this.status = 'error'
        this.error = error.message || 'The processing job failed.'
        this.currentFile = ''
        return null
      }
    },
  },
})

function persistResult(sessionId, result) {
  const resultId = DB.addStudentResult(
    sessionId,
    result.student_name,
    result.section,
    result.image_path,
    result.score,
    result.total,
    result.percentage,
    result.flagged_count,
    result.status,
  )
  result.items.forEach((item) => DB.addResultItem(resultId, item))
}

function queueSignature(answerKeyId, files) {
  const entries = files.map(
    (entry) => entry.key || `${entry.name}|${entry.size}|${entry.lastModified}`,
  )
  return `${answerKeyId || 'no-key'}::${entries.join('::')}`
}

function sourceLabel(files) {
  const hasFolder = files.some(
    (entry) => entry.source === 'Folder' || String(entry.relativePath || '').includes('/'),
  )
  return hasFolder ? 'Web Folder Upload' : 'Web Image Upload'
}
