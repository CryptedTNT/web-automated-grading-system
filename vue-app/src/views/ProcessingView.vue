<script setup>
/* ============================================================
   ProcessingView.vue — processing queue, progress, and log
   Ported from js/processing.js.

   The original had two rendering paths: refresh() rebuilt the whole
   panel, and _renderState() poked a dozen elements by id during the
   run because a full rebuild mid-job would have been too costly.
   Both collapse into this one template — the progress bar, badge,
   counters and log all bind to the store and follow it on their own.
   ============================================================ */

import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { useProcessingStore } from '@/stores/processing.js'

const router = useRouter()
const store = useAppStore()
const job = useProcessingStore()

const logBox = ref(null)

const answerKey = ref(null)
const keyItems = ref([])

async function loadJobDetails() {
  if (!store.selectedAnswerKeyId) {
    answerKey.value = null
    keyItems.value = []
    return
  }
  const keys = await API.answerKeys()
  answerKey.value = keys.find((key) => key.id === store.selectedAnswerKeyId) || null
  keyItems.value = answerKey.value ? await API.answerKeyItems(answerKey.value.id) : []
}

onMounted(() => {
  job.syncQueue()
  loadJobDetails()
})
watch(() => store.selectedAnswerKeyId, loadJobDetails)

/* Each entry is one student's whole submission (one or more pages) --
   see UploadView.vue's grouping and stores/processing.js's _run(). */
const groups = computed(() => store.uploadFiles)
const totalPages = computed(() => groups.value.reduce((sum, group) => sum + group.pages.length, 0))

const canOpenResults = computed(() => Boolean(job.sessionId || store.currentSessionId))

const startDisabled = computed(
  () => job.isRunning || (job.status === 'completed' && !groups.value.length),
)

const countLabel = computed(() => `${job.completed} / ${job.total || groups.value.length} submissions`)

const currentLabel = computed(() => {
  if (job.isRunning && job.cancelRequested) return 'Cancelling after the current submission...'
  if (job.isRunning && job.currentFile) return `Processing ${job.currentFile}`
  if (job.status === 'completed') return `Session #${job.sessionId} is ready for review.`
  if (job.status === 'cancelled') return `Session #${job.sessionId} was cancelled.`
  if (job.status === 'error') return job.error || 'Processing failed.'
  return groups.value.length ? `${groups.value.length} submission(s) ready.` : 'No submissions are queued.'
})

const emptyLogMessage = computed(
  () => job.error || 'Ready. Start processing when the answer key and upload queue are complete.',
)

/* Keep the newest line visible, the way the manual log.scrollTop
   assignment in _renderState() did. */
watch(
  () => job.logs.length,
  async () => {
    await nextTick()
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
  },
)

function openResults() {
  if (job.sessionId) store.currentSessionId = job.sessionId
  router.push({ name: 'results' })
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Processing Answer Sheets</div>
      <div class="page-subtitle">
        Run automated grading and create reviewable results.
      </div>
    </div>

    <div class="processing-banner">
      <span class="badge badge-blue">Automated Grading</span>
      <span>Low-confidence or uncertain answers are flagged for your review.</span>
    </div>

    <div class="workflow-layout processing-layout">
      <section class="card workflow-main">
        <div class="processing-heading">
          <div>
            <div class="card-title">Processing Queue</div>
            <div class="muted-text">{{ currentLabel }}</div>
          </div>
          <span class="badge" :class="job.statusBadgeClass">{{ job.statusLabel }}</span>
        </div>

        <div class="progress-meta">
          <span>{{ job.progress }}% complete</span>
          <span>{{ countLabel }}</span>
        </div>
        <div
          class="progress-bar"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="job.progress"
        >
          <div class="progress-fill" :style="{ width: `${job.progress}%` }"></div>
        </div>

        <div ref="logBox" class="log-box processing-log" aria-live="polite">
          <div v-if="!job.logs.length" class="log-empty">{{ emptyLogMessage }}</div>
          <div
            v-for="(entry, index) in job.logs"
            :key="index"
            class="log-line"
            :class="`log-${entry.level}`"
          >
            <span>{{ entry.time }}</span>{{ entry.message }}
          </div>
        </div>
      </section>

      <aside class="card workflow-sidebar processing-sidebar">
        <div class="card-title">Job Details</div>
        <dl class="job-details">
          <div><dt>Answer key</dt><dd>{{ answerKey?.name || 'Not selected' }}</dd></div>
          <div><dt>Key items</dt><dd>{{ keyItems.length }}</dd></div>
          <div><dt>Queued submissions</dt><dd>{{ groups.length }}</dd></div>
          <div><dt>Queued pages</dt><dd>{{ totalPages }}</dd></div>
          <div>
            <dt>Session</dt>
            <dd>{{ job.sessionId ? `#${job.sessionId}` : 'Not created' }}</dd>
          </div>
        </dl>
        <div class="workflow-actions vertical-actions">
          <button class="btn btn-primary w-full" :disabled="startDisabled" @click="job.start()">
            {{ job.startButtonLabel }}
          </button>
          <button
            v-if="job.isRunning"
            class="btn btn-danger w-full"
            :disabled="job.cancelRequested"
            @click="job.cancel()"
          >
            {{ job.cancelRequested ? 'Cancelling...' : 'Cancel Processing' }}
          </button>
          <button class="btn btn-success w-full" :disabled="!canOpenResults" @click="openResults">
            Open Results
          </button>
          <button class="btn btn-secondary w-full" @click="router.push({ name: 'upload' })">
            Back to Upload
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>
