<script setup>
/* ============================================================
   DashboardView.vue — grading overview
   Ported from dashboard.js.
   ============================================================ */

import { computed } from 'vue'
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'

const store = useAppStore()

const teacherName = computed(() => store.currentUser?.full_name || 'Teacher')

const stats = computed(() => DB.dashboardStats())

/* Each recent session is joined with its results to derive the
   per-session average and flagged count. */
const recentSessions = computed(() =>
  DB.sessions()
    .slice(0, 8)
    .map((session) => {
      const results = DB.studentResults(session.id)
      const average = results.length
        ? Math.round(
            (results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length) * 100,
          ) / 100
        : 0
      const flagged = results.reduce((sum, r) => sum + (r.flagged_count || 0), 0)
      return { ...session, sheets: results.length, average, flagged }
    }),
)

function badgeClass(status) {
  if (status === 'Completed') return 'badge-success'
  if (status === 'Processing') return 'badge-warning'
  return 'badge-gray'
}

const QUICK_ACTIONS = [
  { name: 'answer_key', label: 'New Answer Key', variant: 'btn-primary', title: 'Create or edit an answer key.' },
  { name: 'upload', label: 'Upload Answer Sheets', variant: 'btn-success', title: 'Upload answer sheet images.' },
  { name: 'results', label: 'View Results', variant: 'btn-secondary', title: 'View grading results.' },
  { name: 'reports', label: 'Reports & Analytics', variant: 'btn-secondary', title: 'Export reports.' },
]
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Dashboard</div>
      <div class="page-subtitle">Good day, {{ teacherName }}. Here is the current grading overview.</div>
    </div>

    <div class="flex gap-16 mb-14" style="flex-wrap:wrap;">
      <div class="stat-card">
        <div class="stat-label">Total Sheets Graded</div>
        <div class="stat-value">{{ stats.sheets }}</div>
        <div class="stat-delta">Stored in local storage</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Sessions</div>
        <div class="stat-value">{{ stats.sessions }}</div>
        <div class="stat-delta">Completed and processing sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Flagged for Review</div>
        <div class="stat-value">{{ stats.flagged }}</div>
        <div class="stat-delta">Needs teacher review</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Average Score</div>
        <div class="stat-value">{{ stats.average }}%</div>
        <div class="stat-delta">Across all saved results</div>
      </div>
    </div>

    <div class="workflow-layout">
      <div class="card workflow-main">
        <div class="card-title">Recent Grading Sessions</div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Answer Key</th><th>Sheets</th>
                <th>Average</th><th>Flagged</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in recentSessions" :key="session.id">
                <td>{{ session.created_at }}</td>
                <td>{{ session.answer_key_name || 'No key' }}</td>
                <td>{{ session.sheets }}</td>
                <td>{{ session.average }}%</td>
                <td>{{ session.flagged }}</td>
                <td><span class="badge" :class="badgeClass(session.status)">{{ session.status }}</span></td>
              </tr>
              <tr v-if="!recentSessions.length">
                <td colspan="6" class="muted-text" style="text-align:center;padding:24px;">
                  No grading sessions yet. Create an answer key, upload sheets, then process them.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card workflow-sidebar">
        <div class="card-title">Quick Actions</div>
        <div class="flex flex-col gap-8">
          <RouterLink
            v-for="action in QUICK_ACTIONS"
            :key="action.name"
            v-slot="{ navigate }"
            :to="{ name: action.name }"
            custom
          >
            <button class="btn w-full" :class="action.variant" :title="action.title" @click="navigate">
              {{ action.label }}
            </button>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
