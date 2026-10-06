<script setup>
/* ============================================================
   StudentResultView.vue — item-level result details
   Ported from js/student_result.js.

   Read-only: the Review Flagged page is where items get edited.
   ============================================================ */

import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'
import { canonicalSection } from '@/services/studentDirectory.js'
import { scoreByType } from '@/services/scoreSummary.js'
import { validManualScore } from '@/services/manualScoring.js'

const router = useRouter()
const store = useAppStore()

const result = ref(null)
const items = ref([])
const scoringItem = ref(null)
const awardedPoints = ref('')
const savingPoints = ref(false)

function openScoring(item) {
  scoringItem.value = item
  awardedPoints.value = item.earned ?? 0
}

async function savePoints() {
  if (savingPoints.value || !scoringItem.value) return
  const item = scoringItem.value
  const studentId = result.value.id
  if (!validManualScore(awardedPoints.value, item.points)) {
    await showMessage('Invalid Points', `Enter points from 0 to ${item.points}, with at most two decimal places.`)
    return
  }
  savingPoints.value = true
  try {
    await API.updateResultItem(item.id, { override_action: 'manual_score_override', awarded_score: Number(awardedPoints.value) })
    if (store.selectedStudentResultId !== studentId) return
    result.value = await API.getStudentResultById(studentId)
    items.value = await API.resultItems(studentId)
    scoringItem.value = null
  } catch (error) {
    await showMessage('Could Not Save Points', error.message || 'Please try again.')
  } finally {
    savingPoints.value = false
  }
}
const typeScores = computed(() => scoreByType(items.value))
const editingIdentity = ref(false)
const savingIdentity = ref(false)
const identityForm = ref({ name: '', section: '' })

watch(
  () => store.selectedStudentResultId,
  async (id) => {
    scoringItem.value = null
    result.value = id ? await API.getStudentResultById(id) : null
    items.value = result.value ? await API.resultItems(result.value.id) : []
    editingIdentity.value = false
    identityForm.value = {
      name: result.value?.student_name || '',
      section: canonicalSection(result.value?.section),
    }
  },
  { immediate: true },
)

const hasPendingModel = computed(() =>
  items.value.some((item) => item.model_used === 'Model Pending Placeholder'),
)

const flaggedCount = computed(() => Number(result.value?.flagged_count) || 0)

function statusClass(status) {
  // Item-level status is 'correct'|'incorrect'|'flagged' (grading_result's
  // own values, see database/APP_MAPPING.md) -- NOT the 'OK'/'Wrong'
  // sheet-level labels ResultsView.vue's statusClass() checks for. Every
  // badge on this page used to render as the gray fallback because these
  // comparisons never matched the real data.
  if (status === 'correct') return 'badge-success'
  if (status === 'partial') return 'badge-blue'
  if (status === 'flagged') return 'badge-warning'
  if (status === 'incorrect') return 'badge-danger'
  return 'badge-gray'
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function beginIdentityEdit() {
  identityForm.value = {
    name: result.value?.student_name || '',
    section: canonicalSection(result.value?.section),
  }
  editingIdentity.value = true
}

function cancelIdentityEdit() {
  editingIdentity.value = false
  identityForm.value = {
    name: result.value?.student_name || '',
    section: canonicalSection(result.value?.section),
  }
}

async function saveIdentity() {
  const name = identityForm.value.name.trim()
  const section = identityForm.value.section.trim()
  if (!name || !section) {
    await showMessage('Name and Section Required', 'Enter both a student name and a section before saving.')
    return
  }

  savingIdentity.value = true
  try {
    result.value = await API.updateStudentIdentity(result.value.id, name, section)
    identityForm.value = {
      name: result.value.student_name || '',
      section: canonicalSection(result.value.section),
    }
    editingIdentity.value = false
    await showMessage('Student Details Saved', 'This submission is now listed under the corrected name and section.')
  } catch (error) {
    await showMessage('Could Not Save Student Details', error.message || 'Please try again.')
  } finally {
    savingIdentity.value = false
  }
}
</script>

<template>
  <!-- Nothing selected: the original rendered a separate empty screen
       with its own "Open Results" button. -->
  <div v-if="!result">
    <div class="title-block">
      <div class="page-title">Student Result</div>
      <div class="page-subtitle">Select a student from the Results page.</div>
    </div>
    <section class="card empty-state">
      <div class="muted-text">No student result is selected.</div>
      <button class="btn btn-primary" @click="router.push({ name: 'results' })">
        Open Results
      </button>
    </section>
  </div>

  <div v-else>
    <div class="title-block">
      <div class="page-title">Full Result - {{ result.student_name || 'Unknown' }}</div>
      <div class="page-subtitle">
        Section: {{ canonicalSection(result.section) || '-' }} -
        Score: {{ toNumber(result.score) }} / {{ toNumber(result.total) }} -
        Flagged: {{ toNumber(result.flagged_count) }}
      </div>
    </div>

    <div v-if="hasPendingModel" class="processing-banner">
      <span class="badge badge-blue">Model Pending Placeholder</span>
      <span>Answers shown below are scaffold data awaiting the OCR model.</span>
    </div>

    <section class="card student-identity-card">
      <div class="processing-heading">
        <div>
          <div class="card-title">Student Details</div>
          <div class="muted-text">
            Correct a name or section when handwriting recognition placed this submission under the wrong student.
          </div>
        </div>
        <button v-if="!editingIdentity" class="btn btn-secondary btn-small" @click="beginIdentityEdit">
          Correct Name or Section
        </button>
      </div>

      <div v-if="editingIdentity" class="settings-form-grid student-identity-form">
        <div class="form-group">
          <label class="form-label" for="student-result-name">Student Name</label>
          <input id="student-result-name" v-model="identityForm.name" maxlength="150" autocomplete="name">
        </div>
        <div class="form-group">
          <label class="form-label" for="student-result-section">Section</label>
          <input id="student-result-section" v-model="identityForm.section" maxlength="50" placeholder="Example: BSCS 1-A">
        </div>
      </div>
      <div v-else class="results-summary student-identity-summary">
        <span><strong>Name:</strong> {{ result.student_name || 'Unknown' }}</span>
        <span><strong>Section:</strong> {{ canonicalSection(result.section) || 'No section on file' }}</span>
      </div>

      <div v-if="editingIdentity" class="workflow-actions student-identity-actions">
        <button class="btn btn-primary" :disabled="savingIdentity" @click="saveIdentity">
          {{ savingIdentity ? 'Saving...' : 'Save Student Details' }}
        </button>
        <button class="btn btn-secondary" :disabled="savingIdentity" @click="cancelIdentityEdit">Cancel</button>
      </div>
    </section>

    <section class="card" v-if="typeScores.length">
      <div class="card-title">Score by Question Type</div>
      <div class="type-score-grid">
        <div v-for="score in typeScores" :key="score.type" class="type-score">
          <div>{{ score.type }}</div>
          <strong>{{ score.earned }} / {{ score.total }}</strong>
          <div class="muted-text">{{ score.count }} item(s)<span v-if="score.flagged"> · {{ score.flagged }} awaiting review</span></div>
        </div>
      </div>
      <p v-if="flaggedCount" class="muted-text">Scores are provisional until flagged answers have been reviewed.</p>
    </section>

    <section class="card">
      <div class="table-wrapper student-result-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Type</th><th>Group</th><th>Student Answer</th>
              <th>Correct Answer</th><th>Match %</th><th>Score</th>
              <th>Auto Result</th><th>Final Result</th><th>Manual</th>
              <th>Remarks</th><th>Manual Scoring</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>{{ item.item_no }}</td>
              <td>{{ item.type || '' }}</td>
              <td>{{ item.enum_group ?? '' }}</td>
              <td>{{ item.student_answer || '' }}</td>
              <td>{{ item.correct_answer || '' }}</td>
              <td>{{ toNumber(item.match_score) }}%</td>
              <td>{{ toNumber(item.earned) }} / {{ toNumber(item.points) }}</td>
              <td>
                <span class="badge" :class="statusClass(item.auto_status || item.status)">
                  {{ item.auto_status || item.status }}
                </span>
              </td>
              <td>
                <span class="badge" :class="statusClass(item.status)">{{ item.status === 'partial' ? 'Partial Credit' : item.status }}</span>
              </td>
              <td>{{ item.manual_override ? 'Yes' : 'No' }}</td>
              <td class="remarks-cell">{{ item.remarks || '' }}</td>
              <td><button type="button" class="btn btn-secondary btn-small" :disabled="savingPoints" @click="openScoring(item)">Set Points</button></td>
            </tr>
            <tr v-if="!items.length">
              <td colspan="12" class="table-empty">No item-level records are available.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="workflow-actions">
        <button class="btn btn-secondary" @click="router.push({ name: 'results' })">
          Back to Results
        </button>
        <button
          class="btn btn-primary"
          :disabled="!flaggedCount"
          @click="router.push({ name: 'review' })"
        >
          {{ flaggedCount ? 'Review Flagged' : 'No Flags Remaining' }}
        </button>
      </div>
    </section>
    <div v-if="scoringItem" class="toast-overlay">
      <form class="toast-box" role="dialog" aria-modal="true" aria-labelledby="manual-score-title" @submit.prevent="savePoints">
        <div id="manual-score-title" class="toast-title">Manual Score — Question {{ scoringItem.item_no }}</div>
        <p class="muted-text">Student answer: {{ scoringItem.student_answer || '(blank)' }}</p>
        <label for="student-manual-score" class="form-label">Points Awarded (out of {{ scoringItem.points }})</label>
        <input id="student-manual-score" v-model="awardedPoints" type="number" min="0" :max="scoringItem.points" step="0.01" required>
        <p class="muted-text">Partial credit keeps the extracted answer and original automatic result unchanged.</p>
        <div class="toast-actions">
          <button type="button" class="btn btn-secondary" :disabled="savingPoints" @click="scoringItem = null">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="savingPoints">{{ savingPoints ? 'Saving…' : 'Save Points' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.type-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.type-score { padding: 14px; border: 1px solid rgba(128,128,128,0.3); border-radius: 10px; }
.type-score strong { display: block; font-size: 1.3rem; margin: 8px 0; }
</style>
