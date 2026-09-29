<script setup>
/* ============================================================
   ExamAnalysisView.vue — per-exam (per-session) analysis

   Answers three related IT-expert suggestions in one page instead of
   three overlapping ones: an exam's overall performance, its score
   distribution, and which questions the class missed most. All of it
   is derived from data already served by existing endpoints (session
   results + per-sheet item lists) -- no new backend routes, no
   charting library, just a bucketed table and a CSS width bar.
   ============================================================ */

import { ref, computed, watch, onMounted } from 'vue'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { formatDateTime } from '@/services/datetime.js'
import { sessionTag, sessionLabel, refreshSessionNumbers } from '@/services/sessionNumbers.js'

const store = useAppStore()

const sessions = ref([])
const loading = ref(false)
const results = ref([])
const itemStats = ref([])

const sessionId = computed({
  get: () => store.currentSessionId,
  set: (value) => {
    store.currentSessionId = parseInt(value) || null
  },
})

const selectedSession = computed(() => sessions.value.find((s) => s.id === sessionId.value) || null)

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

async function loadSessions() {
  sessions.value = await API.sessions()
  refreshSessionNumbers(sessions.value)
  if (!sessions.value.some((s) => s.id === store.currentSessionId)) {
    store.currentSessionId = sessions.value[0]?.id || null
  }
}

async function loadSessionData() {
  const id = sessionId.value
  if (!id) {
    results.value = []
    itemStats.value = []
    return
  }
  loading.value = true
  try {
    results.value = await API.studentResults(id)
    const itemLists = await Promise.all(results.value.map((r) => API.resultItems(r.id)))
    const stats = new Map()
    itemLists.forEach((items) => {
      items.forEach((item) => {
        const key = item.item_no
        if (!stats.has(key)) {
          stats.set(key, { item_no: key, type: item.type, sampleAnswer: item.correct_answer, total: 0, missed: 0 })
        }
        const entry = stats.get(key)
        entry.total += 1
        // "Missed" here means not confirmed correct -- an item still
        // sitting flagged for manual review is not yet a correct answer
        // either, so it counts the same as a confirmed-incorrect one.
        if (item.status !== 'correct') entry.missed += 1
      })
    })
    itemStats.value = [...stats.values()]
      .map((entry) => ({
        ...entry,
        missRate: entry.total ? Math.round((entry.missed / entry.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.missRate - a.missRate || a.item_no - b.item_no)
  } finally {
    loading.value = false
  }
}

watch(sessionId, loadSessionData)

onMounted(async () => {
  await loadSessions()
  await loadSessionData()
})

const average = computed(() => {
  if (!results.value.length) return 0
  const sum = results.value.reduce((total, r) => total + toNumber(r.percentage), 0)
  return Math.round((sum / results.value.length) * 100) / 100
})

const flaggedTotal = computed(() =>
  results.value.reduce((total, r) => total + toNumber(r.flagged_count), 0),
)

const SCORE_BUCKETS = [
  { label: '90-100%', test: (p) => p >= 90 },
  { label: '80-89%', test: (p) => p >= 80 && p < 90 },
  { label: '70-79%', test: (p) => p >= 70 && p < 80 },
  { label: '60-69%', test: (p) => p >= 60 && p < 70 },
  { label: 'Below 60%', test: (p) => p < 60 },
]

const distribution = computed(() => {
  const total = results.value.length
  return SCORE_BUCKETS.map((bucket) => {
    const count = results.value.filter((r) => bucket.test(toNumber(r.percentage))).length
    return { label: bucket.label, count, pct: total ? Math.round((count / total) * 100) : 0 }
  })
})

const mostMissed = computed(() => itemStats.value.filter((entry) => entry.missed > 0).slice(0, 10))
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Exam Analysis</div>
      <div class="page-subtitle">
        Overall performance, score distribution, and the questions the class missed most for one exam.
      </div>
    </div>

    <div class="action-bar reports-toolbar">
      <label class="form-label" for="analysis-session">Exam</label>
      <select id="analysis-session" v-model="sessionId">
        <option v-if="!sessions.length" :value="null">No sessions available</option>
        <option v-for="session in sessions" :key="session.id" :value="session.id">
          {{ sessionTag(session.id) }} - {{ formatDateTime(session.created_at) }} - {{ session.answer_key_name || 'No key' }}
        </option>
      </select>
    </div>

    <div v-if="!selectedSession" class="card empty-state">
      <div class="muted-text">No exam selected yet.</div>
    </div>

    <div v-else>
      <div class="stats-grid reports-stats">
        <div class="stat-card">
          <div class="stat-label">Sheets Graded</div>
          <div class="stat-value">{{ results.length }}</div>
          <div class="stat-delta">{{ sessionLabel(selectedSession.id) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Average Score</div>
          <div class="stat-value">{{ average }}%</div>
          <div class="stat-delta">{{ selectedSession.answer_key_name || 'No key' }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Flagged Items</div>
          <div class="stat-value">{{ flaggedTotal }}</div>
          <div class="stat-delta">Across this exam</div>
        </div>
      </div>

      <section class="card">
        <div class="card-title">Score Distribution</div>
        <div v-if="loading" class="muted-text">Loading...</div>
        <table v-else class="distribution-table">
          <tbody>
            <tr v-for="bucket in distribution" :key="bucket.label">
              <td class="distribution-label">{{ bucket.label }}</td>
              <td class="distribution-bar-cell">
                <div class="distribution-bar-track">
                  <div class="distribution-bar-fill" :style="{ width: bucket.pct + '%' }"></div>
                </div>
              </td>
              <td class="distribution-count">{{ bucket.count }} ({{ bucket.pct }}%)</td>
            </tr>
            <tr v-if="!results.length">
              <td colspan="3" class="table-empty">No graded sheets in this exam yet.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <div class="card-title">Questions Most Frequently Answered Incorrectly</div>
        <div class="muted-text mb-8">
          Includes items still flagged for manual review, since those are not yet confirmed correct either.
        </div>
        <div class="table-wrapper reports-table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Item #</th><th>Type</th><th>Correct Answer</th>
                <th>Missed</th><th>Miss Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in mostMissed" :key="entry.item_no">
                <td>{{ entry.item_no }}</td>
                <td>{{ entry.type || '' }}</td>
                <td>{{ entry.sampleAnswer || '' }}</td>
                <td>{{ entry.missed }} / {{ entry.total }}</td>
                <td>{{ entry.missRate }}%</td>
              </tr>
              <tr v-if="!loading && !mostMissed.length">
                <td colspan="5" class="table-empty">No missed items -- every answer was correct.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
