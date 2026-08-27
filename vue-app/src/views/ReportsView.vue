<script setup>
/* ============================================================
   ReportsView.vue — session analytics and the shared export
   Ported from js/reports.js.

   The export itself lives in services/export.js, shared with the
   Results page — the original kept it on the App object for the
   same reason.
   ============================================================ */

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { exportSessionToFile } from '@/services/export.js'

const router = useRouter()
const store = useAppStore()

/* Reads through the FastAPI backend now (api.js), so sessions/stats/
   prefs are refs loaded explicitly rather than a synchronous computed
   over localStorage. refresh() re-runs the same loader. */
const sessions = ref([])
const statsBySession = ref(new Map())

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

/* Sheets/average/flagged per session, computed once from a single
   fetch of every result across every session's sheets, then grouped --
   avoids one API round trip per session row. */
async function loadSessions() {
  const rows = await API.sessions()
  sessions.value = rows

  const resultLists = await Promise.all(rows.map((session) => API.studentResults(session.id)))
  const stats = new Map()
  rows.forEach((session, index) => {
    const results = resultLists[index]
    const percentSum = results.reduce((sum, r) => sum + toNumber(r.percentage), 0)
    const flagged = results.reduce((sum, r) => sum + toNumber(r.flagged_count), 0)
    stats.set(session.id, {
      sheets: results.length,
      average: results.length ? Math.round((percentSum / results.length) * 100) / 100 : 0,
      flagged,
    })
  })
  statsBySession.value = stats
}

onMounted(loadSessions)

/* Mirrors the guard at the top of the original refresh(). */
const selectedSession = computed(() => {
  const all = sessions.value
  if (!all.some((s) => s.id === store.currentSessionId)) {
    store.currentSessionId = all[0]?.id || null
  }
  return all.find((s) => s.id === store.currentSessionId) || null
})

const EMPTY_STATS = { sheets: 0, average: 0, flagged: 0 }

function sessionStats(sessionId) {
  return statsBySession.value.get(sessionId) || EMPTY_STATS
}

const selectedStats = computed(() =>
  selectedSession.value ? sessionStats(selectedSession.value.id) : EMPTY_STATS,
)

/* Capped at 100 rows, as in the original. */
const sessionRows = computed(() =>
  sessions.value.slice(0, 100).map((session) => ({ ...session, ...sessionStats(session.id) })),
)

const prefs = ref({ folder_label: 'Downloads', filename_format: '' })
onMounted(async () => {
  prefs.value = await API.getExportPreferences()
})

const sessionId = computed({
  get: () => store.currentSessionId,
  set: (value) => {
    store.currentSessionId = parseInt(value) || null
  },
})

function openResults() {
  router.push({ name: 'results' })
}

function viewSession(id) {
  store.currentSessionId = parseInt(id) || null
  store.selectedStudentResultId = null
  router.push({ name: 'results' })
}

async function exportSelected() {
  await exportSessionToFile(store.currentSessionId)
}

function statusClass(status) {
  if (status === 'Completed') return 'badge-success'
  if (status === 'Processing') return 'badge-warning'
  if (status === 'Failed') return 'badge-danger'
  return 'badge-gray'
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Reports &amp; Analytics</div>
      <div class="page-subtitle">
        Review session totals and export using saved filename and column preferences.
      </div>
    </div>

    <div class="stats-grid reports-stats">
      <div class="stat-card">
        <div class="stat-label">Sheets in Session</div>
        <div class="stat-value">{{ selectedStats.sheets }}</div>
        <div class="stat-delta">
          {{ selectedSession ? `Session #${selectedSession.id}` : 'No session selected' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Average Score</div>
        <div class="stat-value">{{ selectedStats.average }}%</div>
        <div class="stat-delta">Selected session</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Flagged Items</div>
        <div class="stat-value">{{ selectedStats.flagged }}</div>
        <div class="stat-delta">Selected session</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">All Sessions</div>
        <div class="stat-value">{{ sessions.length }}</div>
        <div class="stat-delta">Stored in your account</div>
      </div>
    </div>

    <div class="action-bar reports-toolbar">
      <label class="form-label" for="rpt-session">Selected Session</label>
      <select id="rpt-session" v-model="sessionId">
        <option v-if="!sessions.length" :value="null">No sessions available</option>
        <option v-for="session in sessions" :key="session.id" :value="session.id">
          #{{ session.id }} - {{ session.created_at }} - {{ session.answer_key_name || 'No key' }}
        </option>
      </select>
      <div class="spacer"></div>
      <button class="btn btn-secondary" @click="openResults">Open Results</button>
      <button class="btn btn-success" @click="exportSelected">Export Selected Session</button>
    </div>

    <div class="export-preference-summary">
      <span class="badge badge-gray">{{ prefs.folder_label }}</span>
      <span>{{ prefs.filename_format }}</span>
    </div>

    <section class="card">
      <div class="card-title">Grading Sessions</div>
      <div class="table-wrapper reports-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Session</th><th>Date</th><th>Answer Key</th><th>Sheets</th>
              <th>Average</th><th>Flagged</th><th>Status</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="session in sessionRows"
              :key="session.id"
              :class="{ selected: session.id === store.currentSessionId }"
            >
              <td>#{{ session.id }}</td>
              <td>{{ session.created_at }}</td>
              <td>{{ session.answer_key_name || 'No key' }}</td>
              <td>{{ session.sheets }}</td>
              <td>{{ session.average }}%</td>
              <td>{{ session.flagged }}</td>
              <td>
                <span class="badge" :class="statusClass(session.status)">{{ session.status }}</span>
              </td>
              <td>
                <button class="btn btn-secondary btn-small" @click="viewSession(session.id)">
                  View
                </button>
              </td>
            </tr>
            <tr v-if="!sessions.length">
              <td colspan="8" class="table-empty">No grading sessions yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
