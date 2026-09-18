<script setup>
/* ============================================================
   DashboardView.vue — grading overview
   Ported from dashboard.js.
   ============================================================ */

import { ref, computed, onMounted } from 'vue'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { formatDateTime } from '@/services/datetime.js'

const store = useAppStore()

const teacherName = computed(() => store.currentUser?.full_name || 'Teacher')

const stats = ref({ sheets: 0, sessions: 0, flagged: 0, average: 0 })
const recentSessions = ref([])

/* Each recent session is joined with its results to derive the
   per-session average and flagged count. Reads through the FastAPI
   backend now (api.js), so this loads once on mount rather than being
   a synchronous computed over localStorage. */
async function load() {
  stats.value = await API.dashboardStats()

  const sessions = (await API.sessions()).slice(0, 8)
  recentSessions.value = await Promise.all(
    sessions.map(async (session) => {
      const results = await API.studentResults(session.id)
      const average = results.length
        ? Math.round(
            (results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length) * 100,
          ) / 100
        : 0
      const flagged = results.reduce((sum, r) => sum + (r.flagged_count || 0), 0)
      return { ...session, sheets: results.length, average, flagged }
    }),
  )
}

onMounted(load)

function badgeClass(status) {
  if (status === 'Completed') return 'badge-success'
  if (status === 'Processing') return 'badge-warning'
  return 'badge-gray'
}

const QUICK_ACTIONS = [
  { name: 'answer_key', label: 'Create answer key', detail: 'Set up questions, answers, and scoring.', variant: 'primary', title: 'Create or edit an answer key.' },
  { name: 'upload', label: 'Upload answer sheets', detail: 'Add scans or photographs for a class.', variant: 'secondary', title: 'Upload answer sheet images.' },
  { name: 'results', label: 'Review results', detail: 'Open completed grading sessions.', variant: 'secondary', title: 'View grading results.' },
  { name: 'reports', label: 'Export report', detail: 'Download results for a completed session.', variant: 'secondary', title: 'Export reports.' },
]

const WORKFLOW_STEPS = [
  { number: '01', title: 'Prepare', detail: 'Create an answer key for the assessment.' },
  { number: '02', title: 'Collect', detail: 'Upload one or more student submissions.' },
  { number: '03', title: 'Review', detail: 'Check flagged answers and export results.' },
]
</script>

<template>
  <div class="dashboard-page">
    <div class="title-block dashboard-title-block">
      <div>
        <div class="page-title">Good day, {{ teacherName }}.</div>
        <div class="page-subtitle">Manage assessments, processing, and results from one place.</div>
      </div>
      <RouterLink :to="{ name: 'upload' }" custom v-slot="{ navigate }">
        <button class="btn btn-primary dashboard-cta" title="Upload answer sheet images." @click="navigate">Upload sheets</button>
      </RouterLink>
    </div>

    <section class="dashboard-start" aria-labelledby="start-grading-title">
      <div class="dashboard-start-copy">
        <span class="section-eyebrow">Start a grading session</span>
        <h2 id="start-grading-title">A clear path from answer key to reviewed results.</h2>
        <p>Create an answer key first, then upload a class set when you are ready to grade.</p>
      </div>
      <div class="dashboard-steps">
        <div v-for="step in WORKFLOW_STEPS" :key="step.number" class="dashboard-step">
          <span>{{ step.number }}</span>
          <div><strong>{{ step.title }}</strong><small>{{ step.detail }}</small></div>
        </div>
      </div>
    </section>

    <section class="metrics-grid" aria-label="Assessment activity summary">
      <article class="metric-panel">
        <span class="metric-label">Sheets graded</span>
        <strong>{{ stats.sheets }}</strong>
        <span class="metric-caption">Across all saved sessions</span>
      </article>
      <article class="metric-panel">
        <span class="metric-label">Grading sessions</span>
        <strong>{{ stats.sessions }}</strong>
        <span class="metric-caption">Completed and in progress</span>
      </article>
      <article class="metric-panel metric-panel-alert">
        <span class="metric-label">Awaiting review</span>
        <strong>{{ stats.flagged }}</strong>
        <span class="metric-caption">Flagged answers to check</span>
      </article>
      <article class="metric-panel">
        <span class="metric-label">Average score</span>
        <strong>{{ stats.average }}<em>%</em></strong>
        <span class="metric-caption">Across saved results</span>
      </article>
    </section>

    <div class="dashboard-content-grid">
      <section class="session-panel" aria-labelledby="recent-sessions-title">
        <div class="panel-heading">
          <div>
            <span class="section-eyebrow">Session history</span>
            <h2 id="recent-sessions-title">Recent grading sessions</h2>
          </div>
          <RouterLink :to="{ name: 'results' }">View all results</RouterLink>
        </div>
        <div class="table-wrapper session-table">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Answer Key</th><th>Sheets</th>
                <th>Average</th><th>Flagged</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in recentSessions" :key="session.id">
                <td>{{ formatDateTime(session.created_at) }}</td>
                <td class="session-key">{{ session.answer_key_name || 'No key' }}</td>
                <td>{{ session.sheets }}</td>
                <td>{{ session.average }}%</td>
                <td>{{ session.flagged }}</td>
                <td><span class="badge" :class="badgeClass(session.status)">{{ session.status }}</span></td>
              </tr>
              <tr v-if="!recentSessions.length">
                <td colspan="6" class="dashboard-empty">
                  <strong>No grading sessions yet</strong>
                  <span>Create an answer key, then upload your first set of answer sheets.</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="action-panel" aria-labelledby="quick-actions-title">
        <div class="panel-heading">
          <div>
            <span class="section-eyebrow">Shortcuts</span>
            <h2 id="quick-actions-title">Continue your work</h2>
          </div>
        </div>
        <div class="action-list">
          <RouterLink
            v-for="action in QUICK_ACTIONS"
            :key="action.name"
            v-slot="{ navigate }"
            :to="{ name: action.name }"
            custom
          >
            <button class="action-link" :class="`action-link-${action.variant}`" :title="action.title" @click="navigate">
              <span><strong>{{ action.label }}</strong><small>{{ action.detail }}</small></span>
              <span class="action-arrow" aria-hidden="true">→</span>
            </button>
          </RouterLink>
        </div>
      </aside>
    </div>
  </div>
</template>
