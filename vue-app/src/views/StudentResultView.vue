<script setup>
/* ============================================================
   StudentResultView.vue — item-level result details
   Ported from js/student_result.js.

   Read-only: the Review Flagged page is where items get edited.
   ============================================================ */

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'

const router = useRouter()
const store = useAppStore()

const result = computed(() =>
  store.selectedStudentResultId ? DB.getStudentResultById(store.selectedStudentResultId) : null,
)

const items = computed(() => (result.value ? DB.resultItems(result.value.id) : []))

const hasPendingModel = computed(() =>
  items.value.some((item) => item.model_used === 'Model Pending Placeholder'),
)

const flaggedCount = computed(() => Number(result.value?.flagged_count) || 0)

function statusClass(status) {
  if (status === 'OK') return 'badge-success'
  if (status === 'Flagged') return 'badge-warning'
  if (status === 'Wrong') return 'badge-danger'
  return 'badge-gray'
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
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
        Section: {{ result.section || '-' }} -
        Score: {{ toNumber(result.score) }} / {{ toNumber(result.total) }} -
        Flagged: {{ toNumber(result.flagged_count) }}
      </div>
    </div>

    <div v-if="hasPendingModel" class="processing-banner">
      <span class="badge badge-blue">Model Pending Placeholder</span>
      <span>Answers shown below are scaffold data awaiting the OCR model.</span>
    </div>

    <section class="card">
      <div class="table-wrapper student-result-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Type</th><th>Group</th><th>Student Answer</th>
              <th>Correct Answer</th><th>Match %</th><th>Score</th>
              <th>Auto Result</th><th>Final Result</th><th>Manual</th>
              <th>Remarks</th><th>Model</th>
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
                <span class="badge" :class="statusClass(item.status)">{{ item.status }}</span>
              </td>
              <td>{{ item.manual_override ? 'Yes' : 'No' }}</td>
              <td class="remarks-cell">{{ item.remarks || '' }}</td>
              <td>{{ item.model_used || '' }}</td>
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
  </div>
</template>
