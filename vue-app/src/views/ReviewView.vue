<script setup>
/* ============================================================
   ReviewView.vue — manual review progression for flagged items

   Redesigned from a single session-wide item sweep into a two-step
   flow: pick a student who has flagged answers, then work through
   just that student's flagged items until none remain. A teacher
   fixing a class set thinks in terms of "whose paper needs fixing,"
   not an arbitrary cross-student queue order -- and this way, saving
   the last flagged item for one student clearly finishes THAT
   student rather than silently sliding into someone else's paper.

   The one place that writes item data. Each save updates the item and
   recalculates the parent student result, then re-reads that same
   student's remaining flagged items -- staying on this screen until
   that student's flags are clear.
   ============================================================ */

import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API, BASE } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'
import { sessionTag, sessionLabel, refreshSessionNumbers } from '@/services/sessionNumbers.js'
import { formatDateTime } from '@/services/datetime.js'
import { canonicalSection } from '@/services/studentDirectory.js'
import { validManualScore } from '@/services/manualScoring.js'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/PaginationBar.vue'

const router = useRouter()
const store = useAppStore()

const sessions = ref([])
const results = ref([])
const loadingList = ref(true)

const sessionId = computed({
  get: () => store.currentSessionId,
  set: (value) => {
    store.currentSessionId = parseInt(value) || null
  },
})

async function loadSessions() {
  sessions.value = await API.sessions()
  refreshSessionNumbers(sessions.value)
  if (!sessions.value.some((s) => s.id === store.currentSessionId)) {
    store.currentSessionId = sessions.value[0]?.id || null
  }
}

async function loadResults() {
  loadingList.value = true
  try {
    results.value = sessionId.value ? await API.studentResults(sessionId.value) : []
  } finally {
    loadingList.value = false
  }
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

const flaggedStudents = computed(() =>
  results.value
    .filter((r) => toNumber(r.flagged_count) > 0)
    .sort((a, b) => toNumber(b.flagged_count) - toNumber(a.flagged_count)),
)
const flaggedStudentsPaging = usePagination(flaggedStudents)
const pagedFlaggedStudents = computed(() => flaggedStudentsPaging.pageItems.value)
watch(sessionId, () => flaggedStudentsPaging.reset())

/* ---------- Per-student review ---------- */
/* null = showing the student list; set = actively reviewing that
   student's flagged items. This is page-local navigation state, not
   the shared store.selectedStudentResultId -- only a real teacher
   action (opening a student, or finishing a save) writes that shared
   field, the same lesson as the earlier fix to this page: merely
   loading/displaying something here must not silently change what a
   different page shows. */
const activeResultId = ref(null)
const activeStudent = computed(() => results.value.find((r) => r.id === activeResultId.value) || null)

const items = ref([])
const loadingItems = ref(false)
const notice = ref('')
const action = ref('override')
const manualAnswer = ref('')
const manualScore = ref('')
const savingReview = ref(false)
const invalid = ref(false)
const manualInput = ref(null)
const cropMissing = ref(false)

const flaggedItems = computed(() =>
  items.value.filter((item) => item.status === 'flagged').sort((a, b) => a.item_no - b.item_no),
)
const currentItem = computed(() => flaggedItems.value[0] || null)

const cropImageUrl = computed(() => (currentItem.value ? `${BASE}/results/${currentItem.value.id}/crop` : ''))

const autoStatus = computed(() =>
  currentItem.value ? currentItem.value.auto_status || currentItem.value.status : '',
)

function resetItemForm() {
  // No action pre-selected: a flagged item needs a deliberate teacher
  // decision, so the form must not be one accidental click away from
  // applying anything. The manual-answer box, if the teacher does pick
  // Override, starts from what was actually extracted -- never from the
  // answer key's own correct answer, which would let an unedited click
  // silently award full credit regardless of what the student wrote.
  action.value = ''
  manualAnswer.value = currentItem.value?.student_answer || ''
  manualScore.value = currentItem.value?.earned ?? 0
  invalid.value = false
  cropMissing.value = false
}

async function loadItems() {
  if (!activeResultId.value) {
    items.value = []
    return
  }
  loadingItems.value = true
  try {
    items.value = await API.resultItems(activeResultId.value)
  } finally {
    loadingItems.value = false
  }
  resetItemForm()
}

/* Opening a student is a deliberate teacher action, so (unlike the old
   per-load sweep) it's correct for this to update the shared selection --
   Student Result should show this same student if the teacher jumps
   there next. */
async function openStudent(resultId) {
  activeResultId.value = resultId
  store.selectedStudentResultId = resultId
  notice.value = ''
  await loadItems()
}

function backToList() {
  activeResultId.value = null
  notice.value = ''
}

function nextFlaggedStudent() {
  const next = flaggedStudents.value.find((r) => r.id !== activeResultId.value)
  if (next) openStudent(next.id)
  else backToList()
}

/* Switching sessions restarts at the student list. */
watch(sessionId, async () => {
  activeResultId.value = null
  notice.value = ''
  await loadResults()
})

onMounted(async () => {
  await loadSessions()
  await loadResults()
  // Legit hand-off: Results page's own "Review Flagged" button can
  // pre-select a student before navigating here. Honor that once, on
  // arrival, without this page ever writing that shared field back on
  // its own just from loading (see the block comment above).
  const preselected = store.selectedStudentResultId
  if (preselected && flaggedStudents.value.some((r) => r.id === preselected)) {
    await openStudent(preselected)
  }
})

function statusClass(status) {
  // Item-level status is 'correct'|'incorrect'|'flagged' (grading_result's
  // own values, see database/APP_MAPPING.md) -- NOT the 'OK'/'Wrong'
  // sheet-level labels ResultsView.vue's statusClass() checks for.
  if (status === 'correct') return 'badge-success'
  if (status === 'partial') return 'badge-blue'
  if (status === 'flagged') return 'badge-warning'
  if (status === 'incorrect') return 'badge-danger'
  return 'badge-gray'
}

async function saveOverride() {
  if (savingReview.value) return
  const item = currentItem.value
  if (!item) return

  notice.value = ''
  if (!action.value) {
    await showMessage('Choose an Action', 'Select Accept, Mark as Incorrect, Override, or Award Manual Points before saving.')
    return
  }
  // The backend validates awarded points against the question maximum
  // and preserves the original automatic result for every review action.
  let updates

  if (action.value === 'accept') {
    updates = { override_action: 'accepted_correct' }
  } else if (action.value === 'wrong') {
    updates = { override_action: 'marked_incorrect' }
  } else if (action.value === 'score') {
    if (!validManualScore(manualScore.value, item.points)) {
      await showMessage('Invalid Points', `Enter points from 0 to ${item.points}, with at most two decimal places.`)
      return
    }
    updates = { override_action: 'manual_score_override', awarded_score: Number(manualScore.value) }
  } else {
    const answer = manualAnswer.value.trim()
    invalid.value = false
    if (!answer) {
      invalid.value = true
      await showMessage('Manual Answer Required', 'Enter the corrected answer before saving.')
      manualInput.value?.focus()
      return
    }
    updates = { student_answer: answer, override_action: 'manual_answer_override' }
  }

  savingReview.value = true
  try {
    await API.updateResultItem(item.id, updates)
    // Database views derive totals directly from the final item scores.
    store.selectedStudentResultId = activeResultId.value
    await loadItems()
    await loadResults()
    if (currentItem.value) notice.value = 'Review saved. The next flagged item for this student is ready.'
  } catch (error) {
    await showMessage('Could Not Save Review', error.message || 'Please try again.')
  } finally {
    savingReview.value = false
  }
}

function openFullResult() {
  store.selectedStudentResultId = activeResultId.value
  router.push({ name: 'student_result' })
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Review Flagged</div>
      <div class="page-subtitle">
        Pick a student with flagged answers, then work through just their flagged items.
      </div>
    </div>

    <div class="action-bar reports-toolbar">
      <label class="form-label" for="review-session">Exam</label>
      <select id="review-session" v-model="sessionId">
        <option v-if="!sessions.length" :value="null">No sessions available</option>
        <option v-for="session in sessions" :key="session.id" :value="session.id">
          {{ sessionTag(session.id) }} - {{ formatDateTime(session.created_at) }} - {{ session.answer_key_name || 'No key' }}
        </option>
      </select>
    </div>

    <!-- Step 1: pick a student -->
    <section v-if="!activeResultId" class="card">
      <div class="card-title">
        Students With Flagged Answers
        <span v-if="flaggedStudents.length" class="badge badge-warning">{{ flaggedStudents.length }}</span>
      </div>
      <div class="table-wrapper reports-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Student Name</th><th>Section</th><th>Flagged Items</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="student in pagedFlaggedStudents" :key="student.id">
              <td>{{ student.student_name || 'Unknown' }}</td>
              <td>{{ canonicalSection(student.section) }}</td>
              <td>{{ toNumber(student.flagged_count) }}</td>
              <td>
                <button class="btn btn-primary btn-small" @click="openStudent(student.id)">
                  Review
                </button>
              </td>
            </tr>
            <tr v-if="!loadingList && !flaggedStudents.length">
              <td colspan="4" class="table-empty">
                {{ sessionId ? 'No flagged answers in this exam.' : 'No exam selected.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar
        v-model:page="flaggedStudentsPaging.page.value"
        v-model:page-size="flaggedStudentsPaging.pageSize.value"
        :page-count="flaggedStudentsPaging.pageCount.value"
        :total="flaggedStudentsPaging.total.value"
        :range-start="flaggedStudentsPaging.rangeStart.value"
        :range-end="flaggedStudentsPaging.rangeEnd.value"
        item-label="student"
      />
      <div class="workflow-actions">
        <button class="btn btn-secondary" @click="router.push({ name: 'results' })">Back to Results</button>
      </div>
    </section>

    <!-- Step 2a: this student's flagged items are all clear -->
    <section v-else-if="!currentItem" class="card review-complete">
      <div class="completion-mark" aria-hidden="true">&#10003;</div>
      <div class="section-title">
        All flagged items for {{ activeStudent?.student_name || 'this student' }} have been reviewed.
      </div>
      <div class="muted-text mt-8">Scores and flagged counts reflect the latest manual decisions.</div>
      <div class="workflow-actions justify-center">
        <button class="btn btn-primary" @click="backToList">Back to Student List</button>
        <button class="btn btn-secondary" @click="openFullResult">View Full Result</button>
        <button v-if="flaggedStudents.length > 1" class="btn btn-secondary" @click="nextFlaggedStudent">
          Review Next Student
        </button>
      </div>
    </section>

    <!-- Step 2b: reviewing this student's current flagged item -->
    <div v-else>
      <div class="title-block">
        <div class="page-title">Review Flagged Answer</div>
        <div class="page-subtitle">
          {{ sessionId ? sessionLabel(sessionId) : 'No session' }} - {{ activeStudent?.student_name || 'Unknown Student' }} -
          Item {{ currentItem.item_no }} - {{ flaggedItems.length }} flagged item(s) remaining for this student
        </div>
      </div>

      <div v-if="notice" class="inline-notice success-notice">{{ notice }}</div>

      <div class="workflow-layout review-layout">
        <section class="card workflow-main">
          <div class="review-meta">
            <span class="badge badge-warning">Flagged</span>
            <span>{{ currentItem.type || 'Question' }}</span>
            <span v-if="currentItem.enum_group">Group {{ currentItem.enum_group }}</span>
          </div>

          <div class="comparison-card scanned-answer-card">
            <div class="card-title">Scanned Answer</div>
            <img
              v-if="!cropMissing"
              :key="cropImageUrl"
              :src="cropImageUrl"
              :alt="`Scanned answer region for item ${currentItem.item_no}`"
              class="review-crop-image"
              @error="cropMissing = true"
            >
            <div v-else class="muted-text">No scanned image is available for this item.</div>
          </div>

          <div class="comparison-row">
            <div class="comparison-card">
              <div class="card-title">Extracted Answer</div>
              <div class="big-answer">{{ currentItem.student_answer || '[blank]' }}</div>
            </div>
            <div class="comparison-card">
              <div class="card-title">Correct Answer</div>
              <div class="big-answer">{{ currentItem.correct_answer || '[not set]' }}</div>
            </div>
          </div>

          <dl class="review-details">
            <div>
              <dt>Automatic result</dt>
              <dd><span class="badge" :class="statusClass(autoStatus)">{{ autoStatus }}</span></dd>
            </div>
            <div><dt>Match score</dt><dd>{{ toNumber(currentItem.match_score) }}%</dd></div>
            <div><dt>Points</dt><dd>{{ toNumber(currentItem.points) }}</dd></div>
          </dl>

          <div v-if="currentItem.remarks" class="remarks-box">
            <strong>Remarks</strong><span>{{ currentItem.remarks }}</span>
          </div>
        </section>

        <aside class="card workflow-sidebar">
          <div class="card-title">Choose Action</div>
          <div class="radio-group">
            <label><input v-model="action" type="radio" value="accept"> Accept as correct</label>
            <label><input v-model="action" type="radio" value="wrong"> Mark as incorrect</label>
            <label><input v-model="action" type="radio" value="override"> Override extracted answer</label>
            <label><input v-model="action" type="radio" value="score"> Award Manual Points / Partial Credit</label>
          </div>

          <div class="form-group mt-14">
            <label class="form-label" for="rev-override">Manual Answer</label>
            <input
              id="rev-override"
              ref="manualInput"
              v-model="manualAnswer"
              type="text"
              :class="{ invalid }"
              :disabled="action !== 'override'"
            >
          </div>

          <div v-if="action === 'score'" class="form-group mt-14">
            <label for="review-manual-score" class="form-label">Points Awarded (out of {{ currentItem.points }})</label>
            <input id="review-manual-score" v-model="manualScore" type="number" min="0" :max="currentItem.points" step="0.01">
            <div class="muted-text">Example: award 2 out of 3 points. The extracted answer is kept unchanged.</div>
          </div>
          <div class="workflow-actions vertical-actions">
            <button class="btn btn-primary w-full" :disabled="savingReview" @click="saveOverride">{{ savingReview ? 'Saving…' : 'Save and Continue' }}</button>
            <button class="btn btn-secondary w-full" @click="backToList">Back to Student List</button>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
