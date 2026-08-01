<script setup>
/* ============================================================
   ReviewView.vue — manual review progression for flagged items
   Ported from js/review.js.

   The one page that writes item data. Each save updates the item,
   recalculates the parent student result, then pulls the next
   flagged item — staying on this screen until the session is clear.
   ============================================================ */

import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'

const router = useRouter()
const store = useAppStore()

/* localStorage is not reactive; saving bumps this to re-read. */
const tick = ref(0)

const notice = ref('')
const lastReviewedResultId = ref(null)
const action = ref('override')
const manualAnswer = ref('')
const invalid = ref(false)
const manualInput = ref(null)

const sessionId = computed(() => store.currentSessionId)

/* Prefer the student already selected on the Results page, but only
   if they belong to this session — otherwise sweep the whole session. */
const currentItem = computed(() => {
  tick.value
  const selected = store.selectedStudentResultId
    ? DB.getStudentResultById(store.selectedStudentResultId)
    : null
  const validResultId = selected?.session_id === sessionId.value ? selected.id : null
  return DB.getFirstFlaggedItem(validResultId, sessionId.value)
})

const result = computed(() =>
  currentItem.value ? DB.getStudentResultById(currentItem.value.student_result_id) : null,
)

const autoStatus = computed(() =>
  currentItem.value ? currentItem.value.auto_status || currentItem.value.status : '',
)

/* The original assigned App.state.selectedStudentResultId in the
   middle of building its HTML. Kept as an effect rather than a
   side effect inside a computed. */
watch(
  currentItem,
  (item) => {
    store.selectedStudentResultId = item
      ? DB.getStudentResultById(item.student_result_id)?.id || null
      : store.selectedStudentResultId
    // Each item gets a fresh form, exactly as the full re-render did.
    action.value = 'override'
    manualAnswer.value = item?.correct_answer || ''
    invalid.value = false
  },
  { immediate: true },
)

/* Switching sessions restarts the review run. */
watch(sessionId, () => {
  lastReviewedResultId.value = null
  notice.value = ''
})

function statusClass(status) {
  if (status === 'OK') return 'badge-success'
  if (status === 'Flagged') return 'badge-warning'
  if (status === 'Wrong') return 'badge-danger'
  return 'badge-gray'
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

async function saveOverride() {
  const item = currentItem.value
  if (!item) return

  notice.value = ''
  const originalAutoStatus = item.auto_status || item.status
  const originalMatch = toNumber(item.match_score)
  let updates

  if (action.value === 'accept') {
    updates = {
      earned: toNumber(item.points),
      status: 'OK',
      manual_override: 1,
      override_action: 'accepted_correct',
      remarks: `Manual review: accepted as correct. Automatic result was ${originalAutoStatus} at ${originalMatch}% match.`,
    }
  } else if (action.value === 'wrong') {
    updates = {
      earned: 0,
      status: 'Wrong',
      manual_override: 1,
      override_action: 'marked_incorrect',
      remarks: `Manual review: marked incorrect. Automatic result was ${originalAutoStatus} at ${originalMatch}% match.`,
    }
  } else {
    const answer = manualAnswer.value.trim()
    invalid.value = false
    if (!answer) {
      invalid.value = true
      await showMessage('Manual Answer Required', 'Enter the corrected answer before saving.')
      manualInput.value?.focus()
      return
    }
    updates = {
      student_answer: answer,
      earned: toNumber(item.points),
      status: 'OK',
      match_score: 100,
      manual_override: 1,
      override_action: 'manual_answer_override',
      remarks: `Manual review: answer changed to '${answer}' and accepted as correct. Automatic result was ${originalAutoStatus} at ${originalMatch}% match.`,
    }
  }

  const reviewedResultId = item.student_result_id
  DB.updateResultItem(item.id, updates)
  DB.recalculateStudentResult(reviewedResultId)
  lastReviewedResultId.value = reviewedResultId

  const nextItem = DB.getFirstFlaggedItem(reviewedResultId, sessionId.value)
  store.selectedStudentResultId = nextItem ? nextItem.student_result_id : reviewedResultId
  tick.value++
  if (nextItem) notice.value = 'Review saved. The next flagged item is ready.'
}

function openLastStudent() {
  store.selectedStudentResultId = lastReviewedResultId.value
  router.push({ name: 'student_result' })
}
</script>

<template>
  <!-- Nothing left to review -->
  <div v-if="!currentItem">
    <div class="title-block">
      <div class="page-title">
        {{ lastReviewedResultId ? 'Review Complete' : 'No Flagged Answers' }}
      </div>
      <div class="page-subtitle">Session #{{ sessionId || '-' }}</div>
    </div>
    <section class="card review-complete">
      <div class="completion-mark" aria-hidden="true">&#10003;</div>
      <div class="section-title">
        {{
          lastReviewedResultId
            ? 'All flagged items in this session have been reviewed.'
            : 'There are no flagged items in the selected session.'
        }}
      </div>
      <div class="muted-text mt-8">
        Scores and flagged counts reflect the latest manual decisions.
      </div>
      <div class="workflow-actions justify-center">
        <button class="btn btn-primary" @click="router.push({ name: 'results' })">
          Back to Results
        </button>
        <button v-if="lastReviewedResultId" class="btn btn-secondary" @click="openLastStudent">
          Open Last Student
        </button>
      </div>
    </section>
  </div>

  <div v-else>
    <div class="title-block">
      <div class="page-title">Review Flagged Answer</div>
      <div class="page-subtitle">
        Session #{{ sessionId || '-' }} - {{ result?.student_name || 'Unknown Student' }} -
        Item {{ currentItem.item_no }}
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
          <div><dt>Model</dt><dd>{{ currentItem.model_used || 'Not recorded' }}</dd></div>
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

        <div class="workflow-actions vertical-actions">
          <button class="btn btn-primary w-full" @click="saveOverride">Save and Continue</button>
          <button class="btn btn-secondary w-full" @click="router.push({ name: 'results' })">
            Back to Results
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>
