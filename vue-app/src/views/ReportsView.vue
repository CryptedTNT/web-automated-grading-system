<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { displayGrade, gradeHeader, gradeSuffix } from '@/services/gradingScale.js'
import { exportStudentsToFile, exportSessionToFile } from '@/services/export.js'
import { canonicalSection } from '@/services/sections.js'
import { studentReportRows } from '@/services/studentReports.js'
import { filterReportSessions, isStudentReportMode } from '@/services/reportFilters.js'
import { formatDateTime } from '@/services/datetime.js'
import { refreshSessionNumbers, sessionTag, sessionLabel } from '@/services/sessionNumbers.js'
import { useProcessingStore } from '@/stores/processing.js'
import { showMessage, showConfirm } from '@/services/dialog.js'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/PaginationBar.vue'

const router = useRouter()
const store = useAppStore()
const shown = (percentage) => displayGrade(percentage, store.gradingScale)
const suffix = computed(() => gradeSuffix(store.gradingScale))
const scoreHeader = computed(() => gradeHeader(store.gradingScale))
const processing = useProcessingStore()
const sessions = ref([])
const records = ref([])
const questionnaireId = ref('')
const section = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const sort = ref('name-asc')
const studentSelectedIds = ref(new Set())
const sessionSelectedIds = ref(new Set())
const studentMode = computed(() => isStudentReportMode(questionnaireId.value, section.value))
const selectedIds = computed({
  get: () => studentMode.value ? studentSelectedIds.value : sessionSelectedIds.value,
  set: (value) => {
    if (studentMode.value) studentSelectedIds.value = value
    else sessionSelectedIds.value = value
  },
})
watch(studentMode, () => {
  studentSelectedIds.value = new Set()
  sessionSelectedIds.value = new Set()
})
const loading = ref(true)
const loadError = ref('')
const exporting = ref(false)
const deletingSelected = ref(false)
const busy = computed(() => exporting.value || deletingSelected.value)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const rows = (await API.sessions()).filter((session) => session.status !== 'Cancelled')
    const lists = await Promise.all(rows.map((session) => API.studentResults(session.id)))
    records.value = lists.flatMap((results, index) => results.map((result) => ({ ...result, session: rows[index] })))
    sessions.value = rows
    refreshSessionNumbers(rows)
  } catch (error) {
    loadError.value = error.message || 'Could not load reports.'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const questionnaires = computed(() => {
  const keys = new Map()
  for (const session of sessions.value) {
    keys.set(session.answer_key_id, session.answer_key_name || `Questionnaire ${session.answer_key_id}`)
  }
  return [...keys].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
})
const sections = computed(() => [...new Set(records.value
  .filter((record) => !questionnaireId.value || String(record.session.answer_key_id) === String(questionnaireId.value))
  .map((record) => canonicalSection(record.section)).filter(Boolean))].sort())
watch(questionnaireId, () => { if (!sections.value.includes(section.value)) section.value = '' })
const students = computed(() => studentReportRows(records.value, {
  questionnaireId: questionnaireId.value, section: section.value,
  dateFrom: dateFrom.value, dateTo: dateTo.value, sort: sort.value,
}))
const sessionRows = computed(() => filterReportSessions(sessions.value, records.value, {
  dateFrom: dateFrom.value, dateTo: dateTo.value,
}))
const activeRows = computed(() => studentMode.value ? students.value : sessionRows.value)
watch(activeRows, (visible) => {
  const ids = new Set(visible.map((row) => row.id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => ids.has(id)))
})
const selectedRows = computed(() => activeRows.value.filter((row) => selectedIds.value.has(row.id)))

/* Paging is purely a display slice of the already-filtered activeRows --
   selection, "select all", and the empty-state message all still read
   activeRows/selectedIds directly, so a bulk export or delete still acts
   on every matching row, not just the ones on screen. Each mode keeps
   its own page/size so switching between Grading Sessions and Student
   Reports doesn't fight over one page number. */
const studentPaging = usePagination(students)
const sessionPaging = usePagination(sessionRows)
// A new filter is a new question, not just a shorter version of the old
// list -- land back on page 1 rather than wherever clamping happens to
// leave the old page number.
watch([questionnaireId, section, dateFrom, dateTo, sort], () => {
  studentPaging.reset()
  sessionPaging.reset()
})
/* Printing must include every selected row, not just the current page --
   browsers only print what's in the DOM. beforeprint/afterprint is the
   one reliable cross-browser hook for "the print dialog is open now",
   so pagination is bypassed for just that moment. */
const printing = ref(false)
const startPrinting = () => { printing.value = true }
const stopPrinting = () => { printing.value = false }
onMounted(() => {
  window.addEventListener('beforeprint', startPrinting)
  window.addEventListener('afterprint', stopPrinting)
})
onUnmounted(() => {
  window.removeEventListener('beforeprint', startPrinting)
  window.removeEventListener('afterprint', stopPrinting)
})
const pagedStudents = computed(() => (printing.value ? students.value : studentPaging.pageItems.value))
const pagedSessions = computed(() => (printing.value ? sessionRows.value : sessionPaging.pageItems.value))
const allSelected = computed(() => activeRows.value.length > 0 && selectedRows.value.length === activeRows.value.length)
const partiallySelected = computed(() => selectedRows.value.length > 0 && !allSelected.value)
function toggleAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(activeRows.value.map((row) => row.id))
}
function toggleStudent(id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function clearFilters() {
  questionnaireId.value = ''
  section.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  sort.value = 'name-asc'
  selectedIds.value = new Set()
  studentSelectedIds.value = new Set()
  sessionSelectedIds.value = new Set()
  studentPaging.reset()
  sessionPaging.reset()
}
async function exportSelected() {
  if (!selectedRows.value.length || exporting.value) return
  exporting.value = true
  try {
    if (studentMode.value) {
      await exportStudentsToFile(selectedRows.value)
    } else {
      const files = []
      for (const session of selectedRows.value) {
        const filename = await exportSessionToFile(session.id, { announce: false })
        if (filename) files.push(filename)
      }
      await showMessage('Session Exports', `${files.length} separate session report(s) downloaded. Allow multiple downloads if your browser asks.`)
    }
  } catch (error) {
    await showMessage('Export Failed', error.message || 'Could not export the selected reports. Try again.')
  } finally {
    exporting.value = false
  }
}
function viewStudent(student) {
  store.currentSessionId = student.session.id
  store.selectedStudentResultId = student.id
  router.push({ name: 'student_result' })
}
function viewSession(session, name = 'results') {
  store.currentSessionId = session.id
  store.selectedStudentResultId = null
  router.push({ name })
}
async function downloadSession(session) {
  if (exporting.value) return
  exporting.value = true
  try {
    await exportSessionToFile(session.id)
  } catch (error) {
    await showMessage('Export Failed', error.message || 'Could not export this session.')
  } finally { exporting.value = false }
}
async function deleteSession(session) {
  if (processing.isRunning && processing.sessionId === session.id) {
    await showMessage('Session Is Processing', 'Cancel grading before deleting this session.')
    return
  }
  if (!await showConfirm('Delete Session', `Permanently delete ${sessionLabel(session.id)} and its ${session.sheets} graded sheets, results, and stored images? This cannot be undone.`)) return
  try {
    await API.clearSession(session.id)
    if (store.currentSessionId === session.id) {
      store.currentSessionId = null
      store.selectedStudentResultId = null
    }
    await load()
  } catch (error) { await showMessage('Could Not Delete Session', error.message || String(error)) }
}

async function deleteSelected() {
  if (!selectedRows.value.length || busy.value) return
  const stillProcessing = selectedRows.value.find((s) => processing.isRunning && processing.sessionId === s.id)
  if (stillProcessing) {
    await showMessage('Session Is Processing', 'Cancel grading before deleting that session, then try again.')
    return
  }
  const targets = [...selectedRows.value]
  const count = targets.length
  if (!await showConfirm(
    'Delete Selected Sessions',
    `Permanently delete ${count} session${count === 1 ? '' : 's'} and ${count === 1 ? 'its' : 'their'} graded sheets, results, and stored images? This cannot be undone.`,
  )) return

  deletingSelected.value = true
  const failures = []
  try {
    for (const session of targets) {
      try {
        await API.clearSession(session.id)
        if (store.currentSessionId === session.id) {
          store.currentSessionId = null
          store.selectedStudentResultId = null
        }
      } catch (error) {
        failures.push(`${sessionLabel(session.id)}: ${error.message || error}`)
      }
    }
    await load()
    if (failures.length) {
      await showMessage('Some Sessions Were Not Deleted', `${count - failures.length} of ${count} deleted. ${failures.join(' ')}`)
    }
  } finally {
    deletingSelected.value = false
  }
}
function printReport() { window.print() }
function statusClass(status) {
  if (status === 'Failed') return 'badge-danger'
  if (status === 'Processing') return 'badge-warning'
  return String(status).toLowerCase() === 'flagged' ? 'badge-warning' : 'badge-success'
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Reports &amp; Analytics</div>
      <div class="page-subtitle">Browse sessions, or choose a questionnaire or section to view and export students.</div>
    </div>
    <section class="card">
      <div class="card-title">{{ studentMode ? 'Student Reports' : 'Grading Sessions' }}</div>
      <div class="student-report-filters no-print" :class="{ 'session-report-filters': !studentMode }">
        <div class="report-filter-field">
          <label class="form-label" for="rpt-questionnaire">Questionnaire</label>
          <select id="rpt-questionnaire" v-model="questionnaireId" :disabled="loading || exporting">
            <option value="">All Questionnaires</option>
            <option v-for="key in questionnaires" :key="key.id" :value="key.id">{{ key.name }} (ID {{ key.id }})</option>
          </select>
        </div>
        <div class="report-filter-field">
          <label class="form-label" for="rpt-section">Section</label>
          <select id="rpt-section" v-model="section" :disabled="loading || exporting">
            <option value="">All Sections</option>
            <option v-for="name in sections" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>
        <div v-if="studentMode" class="report-filter-field">
          <label class="form-label" for="rpt-sort">Sort By</label>
          <select id="rpt-sort" v-model="sort" :disabled="busy">
            <option value="name-asc">Name: A–Z</option>
            <option value="name-desc">Name: Z–A</option>
            <option value="score-desc">Score: Highest First</option>
            <option value="score-asc">Score: Lowest First</option>
          </select>
        </div>
        <div class="report-filter-field">
          <label class="form-label" for="rpt-from">From</label>
          <input id="rpt-from" v-model="dateFrom" type="date" :disabled="busy">
        </div>
        <div class="report-filter-field">
          <label class="form-label" for="rpt-to">To</label>
          <input id="rpt-to" v-model="dateTo" type="date" :disabled="busy">
        </div>
      </div>
      <div class="action-bar reports-toolbar no-print">
        <button class="btn btn-secondary" :disabled="busy" @click="clearFilters">Clear Filters</button>
        <div class="spacer"></div>
        <span v-if="selectedRows.length" class="badge badge-gray">{{ selectedRows.length }} selected</span>
        <button class="btn btn-success" :disabled="!selectedRows.length || busy || loading || !!loadError" @click="exportSelected">
          {{ exporting ? 'Exporting...' : `Export Selected ${studentMode ? 'Students' : 'Sessions'}${selectedRows.length ? ` (${selectedRows.length})` : ''}` }}
        </button>
        <button class="btn btn-secondary" :disabled="busy || loading || !!loadError || !activeRows.length" @click="printReport">Print{{ selectedRows.length ? ' Selected' : '' }}</button>
        <button
          v-if="!studentMode"
          class="btn btn-danger"
          :disabled="!selectedRows.length || busy || loading || !!loadError"
          @click="deleteSelected"
        >
          {{ deletingSelected ? 'Deleting...' : `Delete Selected${selectedRows.length ? ` (${selectedRows.length})` : ''}` }}
        </button>
      </div>
      <p v-if="loading || loadError" role="status">{{ loadError || 'Loading reports...' }}
        <button v-if="loadError" class="btn btn-secondary btn-small no-print" @click="load">Retry</button>
      </p>
      <p v-else-if="studentMode" class="page-subtitle" role="status" aria-live="polite">{{ students.length }} student result(s). The latest completed record per student and questionnaire within the chosen dates. Flagged grades are provisional.</p>
      <p v-else class="page-subtitle" role="status" aria-live="polite">{{ sessionRows.length }} grading session(s).</p>
      <div class="table-wrapper reports-table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="no-print"><input type="checkbox" :aria-label="studentMode ? 'Select all visible students' : 'Select all visible sessions'" :checked="allSelected" :indeterminate="partiallySelected" :disabled="!activeRows.length || busy" @change="toggleAll"></th>
              <template v-if="studentMode">
                <th>Student Name</th><th>Section</th><th>Questionnaire</th><th>Score</th><th>{{ scoreHeader }}</th><th>Flagged</th><th>Status</th><th class="no-print">Action</th>
              </template>
              <template v-else>
                <th>Session</th><th>Date</th><th>Questionnaire</th><th>Sheets</th><th>Average</th><th>Flagged</th><th>Status</th><th class="no-print">Action</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <template v-if="studentMode">
            <tr v-for="student in pagedStudents" :key="student.id" :class="{ selected: selectedIds.has(student.id), 'print-hide': selectedIds.size > 0 && !selectedIds.has(student.id) }">
              <td class="no-print"><input type="checkbox" :aria-label="`Select ${student.student_name || 'unnamed student'} — ${student.session.answer_key_name || 'questionnaire'}`" :checked="selectedIds.has(student.id)" :disabled="busy" @change="toggleStudent(student.id)"></td>
              <td>{{ student.student_name || 'Unknown Student' }}</td>
              <td>{{ student.section || 'Not specified' }}</td>
              <td>{{ student.session.answer_key_name || 'No questionnaire' }}</td>
              <td>{{ student.score }} / {{ student.total }}</td>
              <td>{{ shown(student.percentage) }}{{ suffix }}</td>
              <td>{{ student.flagged_count }}</td>
              <td><span class="badge" :class="statusClass(student.status)">{{ student.status }}</span></td>
              <td class="no-print"><button class="btn btn-secondary btn-small" @click="viewStudent(student)">View</button></td>
            </tr>
            </template>
            <template v-else>
              <tr v-for="session in pagedSessions" :key="session.id" :class="{ selected: selectedIds.has(session.id), 'print-hide': selectedIds.size > 0 && !selectedIds.has(session.id) }">
                <td class="no-print"><input type="checkbox" :aria-label="`Select ${sessionLabel(session.id)}`" :checked="selectedIds.has(session.id)" :disabled="busy" @change="toggleStudent(session.id)"></td>
                <td>{{ sessionTag(session.id) }}</td>
                <td>{{ formatDateTime(session.created_at) }}</td>
                <td>{{ session.answer_key_name || 'No questionnaire' }}</td>
                <td>{{ session.sheets }}</td>
                <td>{{ session.sheets ? shown(session.average) : 0 }}{{ suffix }}</td>
                <td>{{ session.flagged }}</td>
                <td><span class="badge" :class="statusClass(session.status)">{{ session.status }}</span></td>
                <td class="no-print">
                  <div class="action-bar">
                    <button class="btn btn-secondary btn-small" @click="viewSession(session)">View</button>
                    <button class="btn btn-secondary btn-small" @click="viewSession(session, 'exam_analysis')">Analyze</button>
                    <button class="btn btn-secondary btn-small" :disabled="busy" @click="downloadSession(session)">Download</button>
                    <button class="btn btn-danger btn-small" :disabled="busy" @click="deleteSession(session)">Delete</button>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!activeRows.length && !loading"><td colspan="9" class="table-empty">{{ loadError ? 'Reports could not be loaded.' : studentMode ? 'No students match these filters.' : 'No sessions match these dates.' }}</td></tr>
          </tbody>
        </table>
      </div>
      <PaginationBar
        v-if="studentMode"
        v-model:page="studentPaging.page.value"
        v-model:page-size="studentPaging.pageSize.value"
        :page-count="studentPaging.pageCount.value"
        :total="studentPaging.total.value"
        :range-start="studentPaging.rangeStart.value"
        :range-end="studentPaging.rangeEnd.value"
        item-label="student result"
        :disabled="busy || loading"
      />
      <PaginationBar
        v-else
        v-model:page="sessionPaging.page.value"
        v-model:page-size="sessionPaging.pageSize.value"
        :page-count="sessionPaging.pageCount.value"
        :total="sessionPaging.total.value"
        :range-start="sessionPaging.rangeStart.value"
        :range-end="sessionPaging.rangeEnd.value"
        item-label="session"
        :disabled="busy || loading"
      />
    </section>
  </div>
</template>

<style scoped>
.student-report-filters { display: grid; grid-template-columns: minmax(0, 2fr) repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.student-report-filters.session-report-filters { grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr)); }
.report-filter-field { min-width: 0; }
.report-filter-field .form-label { display: block; margin-bottom: 6px; }
.report-filter-field select, .report-filter-field input { width: 100%; min-width: 0; box-sizing: border-box; }
.report-filter-field input[type="date"] { min-height: 40px; padding: 9px 11px; border: 1px solid var(--input-border); border-radius: 8px; font: inherit; font-size: 13px; color: var(--text-primary); background: var(--card-bg); }
@media (max-width: 1100px) { .student-report-filters, .student-report-filters.session-report-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .student-report-filters, .student-report-filters.session-report-filters { grid-template-columns: minmax(0, 1fr); } }
</style>
