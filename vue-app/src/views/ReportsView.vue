<script setup>
/* ============================================================
   ReportsView.vue — session analytics and the shared export
   Ported from js/reports.js.

   The export itself lives in services/export.js, shared with the
   Results page — the original kept it on the App object for the
   same reason.
   ============================================================ */

import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { exportSessionToFile } from '@/services/export.js'
import { formatDateTime } from '@/services/datetime.js'
import { sessionLabel, sessionTag, refreshSessionNumbers } from '@/services/sessionNumbers.js'
import { showConfirm, showMessage } from '@/services/dialog.js'
import { useProcessingStore } from '@/stores/processing.js'

const router = useRouter()
const store = useAppStore()
const processing = useProcessingStore()

/* Reads through the FastAPI backend now (api.js), so sessions/stats/
   prefs are refs loaded explicitly rather than a synchronous computed
   over localStorage. refresh() re-runs the same loader. */
const sessions = ref([])
const statsBySession = ref(new Map())

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

/* Sheets/average/flagged per session, computed once from a single
   fetch of every result across every session's sheets, then grouped --
   avoids one API round trip per session row. */
async function loadSessions() {
  const rows = await API.sessions()
  sessions.value = rows
  refreshSessionNumbers(rows)

  const resultLists = await Promise.all(rows.map((session) => API.studentResults(session.id)))
  const stats = new Map()
  rows.forEach((session, index) => {
    const results = resultLists[index]
    const percentSum = results.reduce((sum, r) => sum + toNumber(r.percentage), 0)
    const flagged = results.reduce((sum, r) => sum + toNumber(r.flagged_count), 0)
    stats.set(session.id, {
      sheets: results.length,
      average: results.length ? Math.round((percentSum / results.length) * 100) / 100 : 0,
      flagged,
    })
  })
  statsBySession.value = stats
}

onMounted(loadSessions)

/* Mirrors the guard at the top of the original refresh(). */
const selectedSession = computed(() => {
  const all = sessions.value
  if (!all.some((s) => s.id === store.currentSessionId)) {
    store.currentSessionId = all[0]?.id || null
  }
  return all.find((s) => s.id === store.currentSessionId) || null
})

/* "Session #" is the teacher's running count of successfully finished
   sessions (oldest = #1), not the raw database id, and it is the same
   number on every page; cancelled/failed sessions have no number --
   see services/sessionNumbers.js. `sessionLabel`/`sessionTag` are
   imported above. */

const EMPTY_STATS = { sheets: 0, average: 0, flagged: 0 }

function sessionStats(sessionId) {
  return statsBySession.value.get(sessionId) || EMPTY_STATS
}

const selectedStats = computed(() =>
  selectedSession.value ? sessionStats(selectedSession.value.id) : EMPTY_STATS,
)

/* Capped at 100 rows, as in the original. */
const sessionRows = computed(() =>
  sessions.value.slice(0, 100).map((session) => ({ ...session, ...sessionStats(session.id) })),
)

const prefs = ref({ folder_label: 'Downloads', filename_format: '' })
onMounted(async () => {
  prefs.value = await API.getExportPreferences()
})

const sessionId = computed({
  get: () => store.currentSessionId,
  set: (value) => {
    store.currentSessionId = parseInt(value) || null
  },
})

/* ---------- Filters (client-side over the already-loaded session list; no
   backend change needed for a table this small) and print ---------- */
const filterAnswerKey = ref('All Answer Keys')
const filterDateFrom = ref('')
const filterDateTo = ref('')

const answerKeyOptions = computed(() =>
  [...new Set(sessions.value.map((s) => s.answer_key_name).filter(Boolean))].sort(),
)

const filteredSessionRows = computed(() => {
  const from = filterDateFrom.value ? new Date(filterDateFrom.value) : null
  // End-of-day so a session created any time on the "to" date is included.
  const to = filterDateTo.value ? new Date(`${filterDateTo.value}T23:59:59.999`) : null

  return sessionRows.value.filter((session) => {
    if (filterAnswerKey.value !== 'All Answer Keys' && session.answer_key_name !== filterAnswerKey.value) {
      return false
    }
    const created = new Date(session.created_at)
    if (from && created < from) return false
    if (to && created > to) return false
    return true
  })
})

/* ---------- Multi-select (checkboxes) for bulk download/print ---------- */
const selectedIds = ref(new Set())
const exporting = ref(false)

// A filter change can hide a row that was selected; drop it from the
// selection so "N selected" never counts a row the teacher can't see.
const filteredSessionIds = computed(() => new Set(filteredSessionRows.value.map((s) => s.id)))
watch(filteredSessionIds, (visible) => {
  const next = new Set([...selectedIds.value].filter((id) => visible.has(id)))
  if (next.size !== selectedIds.value.size) selectedIds.value = next
})

const allVisibleSelected = computed(
  () => filteredSessionRows.value.length > 0 && filteredSessionRows.value.every((s) => selectedIds.value.has(s.id)),
)

function toggleSelectAll() {
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) {
    for (const s of filteredSessionRows.value) next.delete(s.id)
  } else {
    for (const s of filteredSessionRows.value) next.add(s.id)
  }
  selectedIds.value = next
}

function toggleSelect(id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

/* Sequential, not Promise.all -- each export triggers a real browser
   download, and firing many at once is what gets some of them silently
   blocked as a pop-up/multi-download flood. */
async function downloadSelected() {
  if (!selectedIds.value.size) {
    await showMessage('No Sessions Selected', 'Check one or more sessions first.')
    return
  }

  exporting.value = true
  const selected = filteredSessionRows.value.filter((session) => selectedIds.value.has(session.id))
  const exported = []
  const failed = []
  try {
    /* Sequential, not Promise.all: each workbook triggers a real browser
       download. Keeping the browser work ordered prevents a large checked
       list from being treated like a pop-up flood. */
    for (const session of selected) {
      try {
        const filename = await exportSessionToFile(session.id, { announce: false })
        if (filename) exported.push(filename)
      } catch (error) {
        failed.push(`${sessionLabel(session.id)}: ${error.message || 'could not be exported'}`)
      }
    }
  } finally {
    exporting.value = false
  }

  if (exported.length) {
    const count = exported.length
    await showMessage(
      'Exports Started',
      `${count} separate report${count === 1 ? '' : 's'} downloaded. If your browser asks, choose Allow for multiple downloads.`,
    )
  }
  if (failed.length) {
    await showMessage('Some Exports Failed', failed.join('\n'))
  }
}

// Printing with a selection prints only the checked rows (see .print-hide
// in styles.css); with nothing checked it prints every filtered row, same
// as before checkboxes existed.
function printReport() {
  window.print()
}

function openResults() {
  router.push({ name: 'results' })
}

function viewSession(id) {
  store.currentSessionId = parseInt(id) || null
  store.selectedStudentResultId = null
  router.push({ name: 'results' })
}

function analyzeSession(id) {
  store.currentSessionId = parseInt(id) || null
  router.push({ name: 'exam_analysis' })
}

/* Deleting is the only way to get rid of a session, and an answer key
   cannot be deleted while any session used it -- the key's items are tied
   to those sessions' results. The server also removes the stored page
   images and crops, so "delete" really means the student data is gone. */
async function deleteSession(session) {
  if (processing.isRunning && processing.sessionId === session.id) {
    await showMessage('Session Is Processing', 'Cancel the running job on the Processing page before deleting this session.')
    return
  }
  const graded = session.sheets === 1 ? '1 graded sheet' : `${session.sheets} graded sheets`
  const confirmed = await showConfirm(
    'Delete Session',
    `Permanently delete this ${sessionLabel(session.id).toLowerCase()} and its ${graded}, results, and stored answer-sheet images? This cannot be undone. If it is the last session that used its answer key, you will then be able to delete that key.`,
  )
  if (!confirmed) return
  try {
    await API.clearSession(session.id)
  } catch (error) {
    await showMessage('Could Not Delete Session', error.message || String(error))
    return
  }
  if (store.currentSessionId === session.id) {
    store.currentSessionId = null
    store.selectedStudentResultId = null
  }
  await loadSessions()
}

async function exportSelected() {
  // A checked row is an explicit bulk selection. Before this guard, the
  // button's label sounded like it used those checks but silently exported
  // only the session selected in the dropdown.
  if (selectedIds.value.size) {
    await downloadSelected()
    return
  }
  await exportSessionToFile(store.currentSessionId)
}

function statusClass(status) {
  if (status === 'Completed') return 'badge-success'
  if (status === 'Processing') return 'badge-warning'
  if (status === 'Failed') return 'badge-danger'
  return 'badge-gray'
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Reports &amp; Analytics</div>
      <div class="page-subtitle">
        Review session totals and export using saved filename and column preferences.
      </div>
    </div>

    <div class="stats-grid reports-stats">
      <div class="stat-card">
        <div class="stat-label">Sheets in Session</div>
        <div class="stat-value">{{ selectedStats.sheets }}</div>
        <div class="stat-delta">
          {{ selectedSession ? sessionLabel(selectedSession.id) : 'No session selected' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Average Score</div>
        <div class="stat-value">{{ selectedStats.average }}%</div>
        <div class="stat-delta">
          {{ selectedSession ? sessionLabel(selectedSession.id) : 'No session selected' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Flagged Items</div>
        <div class="stat-value">{{ selectedStats.flagged }}</div>
        <div class="stat-delta">
          {{ selectedSession ? sessionLabel(selectedSession.id) : 'No session selected' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">All Sessions</div>
        <div class="stat-value">{{ sessions.length }}</div>
        <div class="stat-delta">Stored in your account</div>
      </div>
    </div>

    <div class="action-bar reports-toolbar no-print">
      <label class="form-label" for="rpt-session">Selected Session</label>
      <select id="rpt-session" v-model="sessionId">
        <option v-if="!sessions.length" :value="null">No sessions available</option>
        <option v-for="session in sessions" :key="session.id" :value="session.id">
          {{ sessionTag(session.id) }} - {{ formatDateTime(session.created_at) }} - {{ session.answer_key_name || 'No key' }}
        </option>
      </select>
      <div class="spacer"></div>
      <button class="btn btn-secondary" @click="openResults">Open Results</button>
      <button
        class="btn btn-success"
        :disabled="exporting || (!selectedIds.size && !store.currentSessionId)"
        :title="selectedIds.size ? 'Download one Excel file for every checked session' : 'Download the session selected above'"
        @click="exportSelected"
      >
        {{ selectedIds.size
          ? `Export ${selectedIds.size} Selected Session${selectedIds.size === 1 ? '' : 's'}`
          : 'Export Selected Session' }}
      </button>
    </div>

    <div class="export-preference-summary no-print">
      <span class="badge badge-gray">{{ prefs.folder_label }}</span>
      <span>{{ prefs.filename_format }}</span>
    </div>

    <div class="action-bar reports-toolbar no-print">
      <label class="form-label" for="rpt-filter-key">Answer Key</label>
      <select id="rpt-filter-key" v-model="filterAnswerKey">
        <option>All Answer Keys</option>
        <option v-for="name in answerKeyOptions" :key="name">{{ name }}</option>
      </select>

      <label class="form-label" for="rpt-filter-from">From</label>
      <input id="rpt-filter-from" v-model="filterDateFrom" type="date" aria-label="From date">

      <label class="form-label" for="rpt-filter-to">To</label>
      <input id="rpt-filter-to" v-model="filterDateTo" type="date" aria-label="To date">

      <div class="spacer"></div>
      <span v-if="selectedIds.size" class="badge badge-gray">{{ selectedIds.size }} selected</span>
      <button
        class="btn btn-secondary"
        title="Download each checked session as its own Excel file"
        :disabled="!selectedIds.size || exporting"
        @click="downloadSelected"
      >
        {{ exporting ? 'Exporting...' : 'Download Selected' }}
      </button>
      <button
        class="btn btn-secondary"
        :title="selectedIds.size ? 'Print only the checked sessions' : 'Print this filtered list of sessions'"
        @click="printReport"
      >
        Print{{ selectedIds.size ? ` Selected (${selectedIds.size})` : '' }}
      </button>
    </div>

    <section class="card">
      <div class="card-title">Grading Sessions</div>
      <div class="table-wrapper reports-table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="no-print">
                <input
                  type="checkbox"
                  aria-label="Select all visible sessions"
                  :checked="allVisibleSelected"
                  :disabled="!filteredSessionRows.length"
                  @change="toggleSelectAll"
                >
              </th>
              <th>Session</th><th>Date</th><th>Answer Key</th><th>Sheets</th>
              <th>Average</th><th>Flagged</th><th>Status</th><th class="no-print">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="session in filteredSessionRows"
              :key="session.id"
              :class="{ selected: session.id === store.currentSessionId, 'print-hide': selectedIds.size > 0 && !selectedIds.has(session.id) }"
            >
              <td class="no-print">
                <input
                  type="checkbox"
                  :aria-label="`Select session ${sessionTag(session.id)}`"
                  :checked="selectedIds.has(session.id)"
                  @change="toggleSelect(session.id)"
                >
              </td>
              <td>{{ sessionTag(session.id) }}</td>
              <td>{{ formatDateTime(session.created_at) }}</td>
              <td>{{ session.answer_key_name || 'No key' }}</td>
              <td>{{ session.sheets }}</td>
              <td>{{ session.average }}%</td>
              <td>{{ session.flagged }}</td>
              <td>
                <span class="badge" :class="statusClass(session.status)">{{ session.status }}</span>
              </td>
              <td class="table-actions no-print">
                <button class="btn btn-secondary btn-small" @click="viewSession(session.id)">
                  View
                </button>
                <button
                  class="btn btn-secondary btn-small"
                  title="See this exam's score distribution and most-missed questions"
                  @click="analyzeSession(session.id)"
                >
                  Analyze
                </button>
                <button
                  class="btn btn-success btn-small"
                  title="Download this session's own Excel file"
                  @click="exportSessionToFile(session.id)"
                >
                  Download
                </button>
                <button
                  class="btn btn-danger btn-small"
                  title="Permanently delete this session, its graded sheets, results and stored images"
                  @click="deleteSession(session)"
                >
                  Delete
                </button>
              </td>
            </tr>
            <tr v-if="!filteredSessionRows.length">
              <td colspan="9" class="table-empty">
                {{ sessions.length ? 'No sessions match the current filters.' : 'No grading sessions yet.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
