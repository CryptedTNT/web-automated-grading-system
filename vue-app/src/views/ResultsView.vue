<script setup>
/* ============================================================
   ResultsView.vue — session results, filters, selection, export
   Ported from js/results.js.
   ============================================================ */

import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { displayGrade, gradeHeader, gradeSuffix } from '@/services/gradingScale.js'
import { showMessage } from '@/services/dialog.js'
import { exportSessionToFile } from '@/services/export.js'
import { formatDateTime } from '@/services/datetime.js'
import { sessionLabel, sessionTag, refreshSessionNumbers } from '@/services/sessionNumbers.js'
import { canonicalSection, loadAllGradedRecords, searchRecords } from '@/services/studentDirectory.js'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/PaginationBar.vue'

const router = useRouter()
const store = useAppStore()
const shown = (percentage) => displayGrade(percentage, store.gradingScale)
const suffix = computed(() => gradeSuffix(store.gradingScale))
const scoreHeader = computed(() => gradeHeader(store.gradingScale))
const ROSTER_BADGES = {
  matched: ['Matched', 'badge-success'],
  confirmed: ['Confirmed', 'badge-success'],
  suggested: ['Check name', 'badge-warning'],
  unmatched: ['Not on list', 'badge-danger'],
}
function rosterBadge(row) {
  return ROSTER_BADGES[row.roster_status] || null
}

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
      shown(row.percentage),
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

/* Pagination -- a new session, section filter, or search term is a new
   question, not a shorter version of the old list, so it lands back on
   page 1 rather than wherever clamping happens to leave the old page. */
const resultsPaging = usePagination(filteredRows)
const pagedRows = computed(() => resultsPaging.pageItems.value)
watch([section, sessionId, query], () => resultsPaging.reset())

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
const matchesPaging = usePagination(crossSessionMatches)
const pagedMatches = computed(() => matchesPaging.pageItems.value)
watch(crossSessionMatches, () => matchesPaging.reset())

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

/* One session can hold students from several sections at once (a stack of
   sheets uploaded together isn't necessarily one class). A single mixed
   spreadsheet was never what a teacher wants to hand to a section adviser,
   so this exports one file per section instead of one file for the whole
   session -- unless the section filter above is already narrowed to one,
   in which case that's the one file produced, matching what's on screen. */
async function exportSession() {
  const id = store.currentSessionId
  if (!id) {
    await showMessage('No Session', 'No grading session to export.')
    return
  }
  if (section.value !== 'All Sections') {
    await exportSessionToFile(id, { section: section.value })
    return
  }

  const groups = [...new Set(rows.value.map((row) => canonicalSection(row.section)))]
  if (groups.length <= 1) {
    await exportSessionToFile(id) // only one section (or none) present -- nothing to split
    return
  }
  const files = []
  for (const group of groups) {
    const filename = await exportSessionToFile(id, { announce: false, section: group })
    if (filename) files.push(filename)
  }
  await showMessage(
    'Session Exported',
    `${files.length} separate file(s) downloaded, one per section. Allow multiple downloads if your browser asks.`,
  )
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
              <th>Section</th><th>Score</th><th>{{ scoreHeader }}</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="match in pagedMatches"
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
              <td>{{ shown(match.percentage) }}{{ suffix }}</td>
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
      <PaginationBar
        v-model:page="matchesPaging.page.value"
        v-model:page-size="matchesPaging.pageSize.value"
        :page-count="matchesPaging.pageCount.value"
        :total="matchesPaging.total.value"
        :range-start="matchesPaging.rangeStart.value"
        :range-end="matchesPaging.rangeEnd.value"
        item-label="matching record"
        :disabled="searchLoading"
      />
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
              <th>#</th><th>Student Name</th><th>Section</th><th>Name Check</th><th>Duplicate</th><th>Score</th>
              <th>{{ scoreHeader }}</th><th>Flagged</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in pagedRows"
              :key="row.id"
              tabindex="0"
              :class="{ selected: row.id === selectedId }"
              @click="selectRow(row.id)"
              @dblclick="openRow(row.id)"
              @keydown.enter="openRow(row.id)"
            >
              <td>{{ resultsPaging.rangeStart.value + index }}</td>
              <td>{{ row.student_name || 'Unknown' }}</td>
              <td>{{ canonicalSection(row.section) }}</td>
              <td>
                <span v-if="rosterBadge(row)" class="badge" :class="rosterBadge(row)[1]">{{ rosterBadge(row)[0] }}</span>
                <span v-else class="muted-text">-</span>
              </td>
              <td>
                <span
                  v-if="row.duplicate_of_sheet_id"
                  class="badge badge-warning"
                  :title="`Already has a graded record for this questionnaire in ${sessionLabel(row.duplicate_of_session_id)}.`"
                >
                  Possible Duplicate
                </span>
                <span v-else class="muted-text">-</span>
              </td>
              <td>{{ toNumber(row.score) }} / {{ toNumber(row.total) }}</td>
              <td>{{ shown(row.percentage) }}{{ suffix }}</td>
              <td>{{ toNumber(row.flagged_count) }}</td>
              <td>
                <span class="badge" :class="statusClass(row.status)">
                  {{ row.status || 'Unknown' }}
                </span>
              </td>
            </tr>
            <tr v-if="!filteredRows.length">
              <td colspan="9" class="table-empty">{{ emptyMessage }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar
        v-model:page="resultsPaging.page.value"
        v-model:page-size="resultsPaging.pageSize.value"
        :page-count="resultsPaging.pageCount.value"
        :total="resultsPaging.total.value"
        :range-start="resultsPaging.rangeStart.value"
        :range-end="resultsPaging.rangeEnd.value"
        item-label="student record"
      />

      <div class="workflow-actions results-actions">
        <button class="btn btn-secondary" @click="reviewFlagged">Review Flagged</button>
        <button class="btn btn-primary" @click="openSelected">Open Student Result</button>
      </div>
    </section>
  </div>
</template>
