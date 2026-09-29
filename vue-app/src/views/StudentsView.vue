<script setup>
/* ============================================================
   StudentsView.vue — every graded student and every answer key,
   rolled up across all sessions.

   There is no persistent student identity in this system (a "student"
   is only the OCR-recognized name on a sheet), so "all records of a
   student" means "every graded result whose recognized name matches" --
   the same assumption the Results page's cross-session search already
   makes. This page is a permanent, browsable index of that, rather than
   something only reachable by typing a search term first.
   ============================================================ */

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app.js'
import { API } from '@/services/api.js'
import { formatDateTime } from '@/services/datetime.js'
import { sessionTag, refreshSessionNumbers } from '@/services/sessionNumbers.js'
import {
  canonicalSection,
  loadAllGradedRecords,
  groupByStudent,
  groupByAnswerKey,
  needsAttention,
} from '@/services/studentDirectory.js'

const router = useRouter()
const store = useAppStore()

const loading = ref(true)
const records = ref([])
const query = ref('')
const selectedStudentKey = ref(null)
const selectedSection = ref('All Sections')
const studentSort = ref('name')

async function load() {
  loading.value = true
  try {
    const sessions = await API.sessions()
    refreshSessionNumbers(sessions)
    records.value = await loadAllGradedRecords()
  } finally {
    loading.value = false
  }
}
onMounted(load)

const students = computed(() => groupByStudent(records.value))
const answerKeys = computed(() => groupByAnswerKey(records.value))
const sections = computed(() =>
  [...new Set(students.value.map((student) => student.section).filter(Boolean))].sort(),
)

const filteredStudents = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const list = students.value.filter((student) => {
    if (selectedSection.value !== 'All Sections' && student.section !== selectedSection.value) return false
    return !needle ||
      student.name.toLowerCase().includes(needle) ||
      student.section.toLowerCase().includes(needle)
  })
  return list.sort((left, right) => {
    if (studentSort.value === 'section') {
      return left.section.localeCompare(right.section) || left.name.localeCompare(right.name)
    }
    if (studentSort.value === 'attention') {
      return left.average - right.average || left.name.localeCompare(right.name)
    }
    return left.name.localeCompare(right.name) || left.section.localeCompare(right.section)
  })
})

const attentionCount = computed(() => students.value.filter(needsAttention).length)

const selectedStudent = computed(
  () => students.value.find((student) => student.key === selectedStudentKey.value) || null,
)

function selectStudent(student) {
  selectedStudentKey.value = student.key
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

/* Oldest-first, for reading left-to-right as "over time" -- the detail
   table itself stays newest-first (see groupByStudent), so this is a
   separate view over the same records rather than re-sorting the table. */
const trendPoints = computed(() => {
  if (!selectedStudent.value) return []
  return [...selectedStudent.value.records].sort(
    (a, b) => new Date(a.session.created_at) - new Date(b.session.created_at),
  )
})

// A flat "Steady" reading up to +/-5 points keeps ordinary score noise
// (one harder exam, one lucky guess) from being reported as a trend.
const TREND_FLAT_BAND = 5

const trendSummary = computed(() => {
  const points = trendPoints.value
  if (points.length < 2) return null
  const first = toNumber(points[0].percentage)
  const last = toNumber(points[points.length - 1].percentage)
  const delta = Math.round((last - first) * 10) / 10
  let label = 'Steady'
  if (delta > TREND_FLAT_BAND) label = 'Improving'
  else if (delta < -TREND_FLAT_BAND) label = 'Declining'
  return { first, last, delta, label, exams: points.length }
})

// A small inline sparkline (plain SVG, no charting library) over the same
// points -- normalized to the student's own min/max so a flat run near
// 90% and a flat run near 40% both still show as a visible flat line.
const SPARKLINE_WIDTH = 240
const SPARKLINE_HEIGHT = 48
const SPARKLINE_PAD = 6

const sparklinePoints = computed(() => {
  const values = trendPoints.value.map((p) => toNumber(p.percentage))
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const usableW = SPARKLINE_WIDTH - SPARKLINE_PAD * 2
  const usableH = SPARKLINE_HEIGHT - SPARKLINE_PAD * 2
  return values
    .map((value, index) => {
      const x = SPARKLINE_PAD + (usableW * index) / (values.length - 1)
      const y = SPARKLINE_PAD + usableH - ((value - min) / range) * usableH
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
    })
    .join(' ')
})

function openRecord(record) {
  store.currentSessionId = record.session.id
  store.selectedStudentResultId = record.id
  router.push({ name: 'student_result' })
}

function statusClass(status) {
  if (status === 'OK') return 'badge-success'
  if (status === 'Flagged') return 'badge-warning'
  if (status === 'Wrong' || status === 'Failed') return 'badge-danger'
  return 'badge-gray'
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Students</div>
      <div class="page-subtitle">
        Every graded student and answer key across all sessions. Select a student to see their full history.
      </div>
    </div>

    <div v-if="selectedStudent">
      <section class="card">
        <div class="card-title">{{ selectedStudent.name }}</div>
        <div class="results-summary">
          <span>{{ selectedStudent.section || 'No section on file' }}</span>
          <span><strong>{{ selectedStudent.sheets }}</strong> sheet(s) graded</span>
          <span><strong>{{ selectedStudent.average }}%</strong> average score</span>
          <span v-if="needsAttention(selectedStudent)" class="badge badge-warning">Needs Attention</span>
        </div>

        <div v-if="trendSummary" class="student-trend">
          <svg
            class="student-trend-sparkline"
            :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`"
            role="img"
            :aria-label="`Score trend: ${trendSummary.label}, from ${trendSummary.first}% to ${trendSummary.last}%`"
          >
            <polyline :points="sparklinePoints" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
          <div>
            <strong>{{ trendSummary.label }}</strong>
            <span class="muted-text">
              {{ trendSummary.first }}% &rarr; {{ trendSummary.last }}% over {{ trendSummary.exams }} exams
            </span>
          </div>
        </div>

        <div class="table-wrapper reports-table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Session</th><th>Date</th><th>Answer Key</th>
                <th>Score</th><th>% Score</th><th>Flagged</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="record in selectedStudent.records"
                :key="record.id"
              >
                <td>{{ sessionTag(record.session.id) }}</td>
                <td>{{ formatDateTime(record.session.created_at) }}</td>
                <td>{{ record.session.answer_key_name || 'No key' }}</td>
                <td>{{ toNumber(record.score) }} / {{ toNumber(record.total) }}</td>
                <td>{{ toNumber(record.percentage) }}%</td>
                <td>{{ toNumber(record.flagged_count) }}</td>
                <td>
                  <span class="badge" :class="statusClass(record.status)">{{ record.status || 'Unknown' }}</span>
                </td>
                <td>
                  <button
                    class="btn btn-secondary btn-small"
                    :aria-label="`View result from ${sessionTag(record.session.id)}`"
                    @click="openRecord(record)"
                  >
                    View Result
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="workflow-actions">
          <div class="muted-text student-correction-hint">
            Need to correct a recognized name or section? Open the relevant submission below.
          </div>
          <button class="btn btn-secondary" @click="selectedStudentKey = null">Back to Student List</button>
        </div>
      </section>
    </div>

    <div v-else class="students-grid">
      <section class="card">
        <div class="card-title">
          Students Graded
          <span v-if="attentionCount" class="badge badge-warning">{{ attentionCount }} need attention</span>
        </div>
        <div class="action-bar">
          <input v-model="query" type="text" placeholder="Search student or section..." aria-label="Search students">
          <select v-model="selectedSection" aria-label="Filter students by section">
            <option>All Sections</option>
            <option v-for="sectionName in sections" :key="sectionName">{{ sectionName }}</option>
          </select>
          <select v-model="studentSort" aria-label="Sort students">
            <option value="name">Sort: Name</option>
            <option value="section">Sort: Section</option>
            <option value="attention">Sort: Lowest Average First</option>
          </select>
        </div>
        <div class="table-wrapper reports-table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Student Name</th><th>Section</th><th>Sheets Graded</th><th>Average Score</th><th></th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="student in filteredStudents"
                :key="student.key"
              >
                <td>{{ student.name }}</td>
                <td>{{ canonicalSection(student.section) }}</td>
                <td>{{ student.sheets }}</td>
                <td>{{ student.average }}%</td>
                <td>
                  <span v-if="needsAttention(student)" class="badge badge-warning">Needs Attention</span>
                </td>
                <td>
                  <button
                    class="btn btn-secondary btn-small"
                    :aria-label="`View ${student.name}'s details`"
                    @click="selectStudent(student)"
                  >
                    View Details
                  </button>
                </td>
              </tr>
              <tr v-if="!loading && !filteredStudents.length">
                <td colspan="6" class="table-empty">
                  {{ students.length ? 'No students match your search.' : 'No graded students yet.' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-title">Answer Keys</div>
        <div class="table-wrapper reports-table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Answer Key</th><th>Sheets Graded</th><th>Sessions</th><th>Average Score</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="key in answerKeys" :key="key.name">
                <td>{{ key.name }}</td>
                <td>{{ key.sheets }}</td>
                <td>{{ key.sessions }}</td>
                <td>{{ key.average }}%</td>
              </tr>
              <tr v-if="!loading && !answerKeys.length">
                <td colspan="4" class="table-empty">No sheets graded yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
