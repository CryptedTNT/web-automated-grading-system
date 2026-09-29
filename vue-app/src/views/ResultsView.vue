<script setup>
/* ============================================================
   ResultsView.vue — session results, filters, selection, export
   Ported from js/results.js.
   ============================================================ */

import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'
import { exportSessionToFile } from '@/services/export.js'
import { formatDateTime } from '@/services/datetime.js'
import { sessionLabel, sessionTag, refreshSessionNumbers } from '@/services/sessionNumbers.js'
import { canonicalSection, loadAllGradedRecords, searchRecords } from '@/services/studentDirectory.js'

const router = useRouter()
const store = useAppStore()

const query = ref(store.searchTerm || '')
const section = ref('All Sections')

/* Reads through the FastAPI backend now (api.js), so session/row data
   is loaded explicitly rather than being a synchronous computed over
   localStorage — `sessions`/`rows` are refs, populated by the loaders
   below and re-populated by watchers when the selected session changes. */
const sessions = ref([])
async function loadSessions() {
  sessions.value = await API.sessions()
  refreshSessionNumbers(sessions.value)
}

/* Mirrors the guard at the top of the original refresh(): if the
   stored session id no longer exists, fall back to the newest one. */
const currentSession = computed(() => {
  const all = sessions.value
  if (!all.some((s) => s.id === store.currentSessionId)) {
    store.currentSessionId = all[0]?.id || null
  }
  return all.find((s) => s.id === store.currentSessionId) || null
})

const rows = ref([])
const hasPendingModel = ref(false)

async function loadRows() {
  const current = currentSession.value
  if (!current) {
    rows.value = []
    hasPendingModel.value = false
    return
  }
  rows.value = await API.studentResults(current.id)

  hasPendingModel.value = false
  if (current.status === 'Completed') {
    const itemLists = await Promise.all(rows.value.map((row) => API.resultItems(row.id)))
    hasPendingModel.value = itemLists.some((items) =>
      items.some((item) => item.model_used === 'Model Pending Placeholder'),
    )
  }
}

watch(currentSession, loadRows)

async function refresh() {
  await loadSessions()
  await loadRows()
}

const sections = computed(() =>
  [...new Set(rows.value.map((row) => canonicalSection(row.section)).filter(Boolean))].sort(),
)

/* A section filter that no longer exists in this session must not
   silently hide every row. */
watch(sections, (list) => {
  if (section.value !== 'All Sections' && !list.includes(section.value)) {
    section.value = 'All Sections'
  }
})

const filteredRows = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (section.value !== 'All Sections' && canonicalSection(row.section) !== section.value) {
      return false
    }
    if (!needle) return true
    return [
      row.student_name,
      canonicalSection(row.section),
      row.status,
      row.score,
      row.total,
      row.percentage,
      currentSession.value?.answer_key_name,
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })
})

const flaggedTotal = computed(() =>
  rows.value.reduce((sum, row) => sum + (Number(row.flagged_count) || 0), 0),
)

const emptyMessage = computed(() =>
  rows.value.length
    ? 'No results match the current filters.'
    : 'This session has no student records.',
)

/* ---------- Selection ---------- */
/* The original tracked this twice — a module-level selectedResultId
   plus App.state.selectedStudentResultId, kept in sync by hand. The
   store is the single source now. */
const selectedId = computed(() => store.selectedStudentResultId)

watch(rows, (list) => {
  if (!list.some((row) => row.id === store.selectedStudentResultId)) {
    store.selectedStudentResultId = null
  }
})

function selectRow(id) {
  store.selectedStudentResultId = id
}

function openRow(id) {
  selectRow(id)
  openSelected()
}

/* ---------- Session switching ---------- */
const sessionId = computed({
  get: () => store.currentSessionId,
  set: (value) => {
    store.currentSessionId = parseInt(value) || null
    store.selectedStudentResultId = null
    section.value = 'All Sections'
  },
})

/* ---------- Global search ---------- */
/* A name match should surface every one of that student's past records,
   not just the first session containing one -- a teacher looking up a
   student wants their whole history, not a single exam picked for them.
   So a non-empty query searches every session's results (not just the
   currently-selected one) and lists every matching row, tagged with its
   own session, instead of jumping into one session and filtering it. */
const searching = computed(() => query.value.trim().length > 0)
const crossSessionMatches = ref([])
const searchLoading = ref(false)

async function runCrossSessionSearch(value) {
  query.value = String(value || '')
  const needle = query.value.trim()
  if (!needle) {
    crossSessionMatches.value = []
    return
  }

  searchLoading.value = true
  try {
    const records = await loadAllGradedRecords()
    const matches = searchRecords(records, needle)
    // Most recent exam first, so a student's latest record is easiest to find.
    matches.sort((a, b) => new Date(b.session.created_at) - new Date(a.session.created_at))
    crossSessionMatches.value = matches
  } finally {
    searchLoading.value = false
  }
}

watch(() => store.searchTerm, runCrossSessionSearch)
watch(query, (value) => {
  if (value !== store.searchTerm) runCrossSessionSearch(value)
})

/* Typing in the top bar sets searchTerm and *then* routes here, so on
   arrival the watcher above has already missed its edge. Run the search
   once for the term we were mounted with — after sessions have loaded,
   since it needs `sessions.value` populated. */
onMounted(async () => {
  await loadSessions()
  if (store.searchTerm.trim()) await runCrossSessionSearch(store.searchTerm)
})

function openMatch(match) {
  store.currentSessionId = match.session.id
  store.selectedStudentResultId = match.id
  router.push({ name: 'student_result' })
}

/* ---------- Actions ---------- */
async function openSelected() {
  if (!store.selectedStudentResultId) {
    await showMessage('Student Required', 'Select a student row first.')
    return
  }
  router.push({ name: 'student_result' })
}

async function reviewFlagged() {
  if (!rows.value.some((row) => Number(row.flagged_count) > 0)) {
    await showMessage('Nothing to Review', 'This session has no flagged items.')
    return
  }
  const selected = rows.value.find((row) => row.id === store.selectedStudentResultId)
  store.selectedStudentResultId =
    selected && Number(selected.flagged_count) > 0 ? selected.id : null
  router.push({ name: 'review' })
}

async function exportSession() {
  await exportSessionToFile(store.currentSessionId)
}

/* ---------- Display helpers ---------- */
function statusClass(status) {
  if (status === 'OK') return 'badge-success'
  if (status === 'Flagged') return 'badge-warning'
  if (status === 'Wrong' || status === 'Failed') return 'badge-danger'
  return 'badge-gray'
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Grading Results</div>
      <div class="page-subtitle">
        <template v-if="currentSession">
          {{ sessionLabel(currentSession.id) }} - {{ currentSession.answer_key_name }} -
          {{ currentSession.status }}
        </template>
        <template v-else>No grading session is available.</template>
      </div>
    </div>

    <div class="action-bar results-toolbar">
      <input
        v-model="query"
        type="text"
        placeholder="Search student, section, status..."
        aria-label="Search results"
      >

      <select v-if="!searching" v-model="sessionId" aria-label="Select grading session">
        <option v-if="!sessions.length" :value="null">No sessions available</option>
        <option v-for="session in sessions" :key="session.id" :value="session.id">
          {{ sessionTag(session.id) }} - {{ formatDateTime(session.created_at) }} - {{ session.answer_key_name || 'No key' }}
        </option>
      </select>

      <select v-if="!searching" v-model="section" aria-label="Filter by section">
        <option>All Sections</option>
        <option v-for="name in sections" :key="name">{{ name }}</option>
      </select>

      <div class="spacer"></div>
      <button v-if="!searching" class="btn btn-secondary" @click="refresh">Refresh</button>
      <button v-if="!searching" class="btn btn-success" @click="exportSession">Export Session</button>
    </div>

    <!-- Searching: every matching record across every session, not just the
         currently-selected one -- a student's whole history in one place. -->
    <section v-if="searching" class="card">
      <div class="results-summary">
        <span><strong>{{ crossSessionMatches.length }}</strong> matching record(s) across all sessions</span>
        <span v-if="searchLoading" class="muted-text">Searching...</span>
      </div>

      <div class="table-wrapper results-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Session</th><th>Date</th><th>Answer Key</th><th>Student Name</th>
              <th>Section</th><th>Score</th><th>% Score</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="match in crossSessionMatches"
              :key="match.id"
              tabindex="0"
              @click="openMatch(match)"
              @keydown.enter="openMatch(match)"
            >
              <td>{{ sessionTag(match.session.id) }}</td>
              <td>{{ formatDateTime(match.session.created_at) }}</td>
              <td>{{ match.session.answer_key_name || 'No key' }}</td>
              <td>{{ match.student_name || 'Unknown' }}</td>
              <td>{{ canonicalSection(match.section) }}</td>
              <td>{{ toNumber(match.score) }} / {{ toNumber(match.total) }}</td>
              <td>{{ toNumber(match.percentage) }}%</td>
              <td>
                <span class="badge" :class="statusClass(match.status)">
                  {{ match.status || 'Unknown' }}
                </span>
              </td>
            </tr>
            <tr v-if="!searchLoading && !crossSessionMatches.length">
              <td colspan="8" class="table-empty">No records match this search.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="card">
      <div class="results-summary">
        <span><strong>{{ rows.length }}</strong> student record(s)</span>
        <span><strong>{{ flaggedTotal }}</strong> flagged item(s)</span>
        <span v-if="hasPendingModel" class="badge badge-blue">Model Pending Placeholder</span>
      </div>

      <div class="table-wrapper results-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Student Name</th><th>Section</th><th>Score</th>
              <th>% Score</th><th>Flagged</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in filteredRows"
              :key="row.id"
              tabindex="0"
              :class="{ selected: row.id === selectedId }"
              @click="selectRow(row.id)"
              @dblclick="openRow(row.id)"
              @keydown.enter="openRow(row.id)"
            >
              <td>{{ index + 1 }}</td>
              <td>{{ row.student_name || 'Unknown' }}</td>
              <td>{{ canonicalSection(row.section) }}</td>
              <td>{{ toNumber(row.score) }} / {{ toNumber(row.total) }}</td>
              <td>{{ toNumber(row.percentage) }}%</td>
              <td>{{ toNumber(row.flagged_count) }}</td>
              <td>
                <span class="badge" :class="statusClass(row.status)">
                  {{ row.status || 'Unknown' }}
                </span>
              </td>
            </tr>
            <tr v-if="!filteredRows.length">
              <td colspan="7" class="table-empty">{{ emptyMessage }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="workflow-actions results-actions">
        <button class="btn btn-secondary" @click="reviewFlagged">Review Flagged</button>
        <button class="btn btn-primary" @click="openSelected">Open Student Result</button>
      </div>
    </section>
  </div>
</template>
