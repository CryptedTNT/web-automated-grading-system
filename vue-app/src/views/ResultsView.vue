<script setup>
/* ============================================================
   ResultsView.vue — session results, filters, selection, export
   Ported from js/results.js.
   ============================================================ */

import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'
import { exportSessionToFile } from '@/services/export.js'

const router = useRouter()
const store = useAppStore()

/* DB reads localStorage, which is not reactive. Bumping this ref is
   what makes the Refresh button re-read — every computed below
   depends on it. The original just called refresh() and rebuilt the
   DOM by hand. */
const refreshTick = ref(0)
function refresh() {
  refreshTick.value++
}

const query = ref(store.searchTerm || '')
const section = ref('All Sections')

const sessions = computed(() => {
  refreshTick.value
  return DB.sessions()
})

/* Mirrors the guard at the top of the original refresh(): if the
   stored session id no longer exists, fall back to the newest one. */
const currentSession = computed(() => {
  const all = sessions.value
  if (!all.some((s) => s.id === store.currentSessionId)) {
    store.currentSessionId = all[0]?.id || null
  }
  return all.find((s) => s.id === store.currentSessionId) || null
})

const rows = computed(() => {
  refreshTick.value
  return currentSession.value ? DB.studentResults(currentSession.value.id) : []
})

const sections = computed(() =>
  [...new Set(rows.value.map((row) => String(row.section || '').trim()).filter(Boolean))].sort(),
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
    if (section.value !== 'All Sections' && String(row.section || '') !== section.value) {
      return false
    }
    if (!needle) return true
    return [
      row.student_name,
      row.section,
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

const hasPendingModel = computed(
  () =>
    currentSession.value?.status === 'Completed' &&
    rows.value.some((row) =>
      DB.resultItems(row.id).some((item) => item.model_used === 'Model Pending Placeholder'),
    ),
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
/* Replaces applySearch(): the top-bar box jumps to whichever session
   contains a match before filtering within it. */
function jumpToMatchingSession(value) {
  query.value = String(value || '')
  const needle = query.value.trim().toLowerCase()
  if (!needle) return

  const match = sessions.value.find((session) => {
    if (String(session.answer_key_name || '').toLowerCase().includes(needle)) return true
    return DB.studentResults(session.id).some((row) =>
      [row.student_name, row.section, row.status].join(' ').toLowerCase().includes(needle),
    )
  })
  if (match) {
    store.currentSessionId = match.id
    store.selectedStudentResultId = null
  }
}

watch(() => store.searchTerm, jumpToMatchingSession)

/* Typing in the top bar sets searchTerm and *then* routes here, so on
   arrival the watcher above has already missed its edge. Run the jump
   once for the term we were mounted with. */
if (store.searchTerm.trim()) jumpToMatchingSession(store.searchTerm)

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

function exportSession() {
  exportSessionToFile(store.currentSessionId)
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
          Session #{{ currentSession.id }} - {{ currentSession.answer_key_name }} -
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

      <select v-model="sessionId" aria-label="Select grading session">
        <option v-if="!sessions.length" :value="null">No sessions available</option>
        <option v-for="session in sessions" :key="session.id" :value="session.id">
          #{{ session.id }} - {{ session.created_at }} - {{ session.answer_key_name || 'No key' }}
        </option>
      </select>

      <select v-model="section" aria-label="Filter by section">
        <option>All Sections</option>
        <option v-for="name in sections" :key="name">{{ name }}</option>
      </select>

      <div class="spacer"></div>
      <button class="btn btn-secondary" @click="refresh">Refresh</button>
      <button class="btn btn-success" @click="exportSession">Export Session</button>
    </div>

    <section class="card">
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
              <td>{{ row.section || '' }}</td>
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
