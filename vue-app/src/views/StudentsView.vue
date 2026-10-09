<script setup>
/* ============================================================
   StudentsView.vue -- the class lists the teacher handles.

   A section (for example BSCS 1-A) holds its students in the order the
   teacher gave them. Students are added one at a time, read from a photo
   of a list (order kept top to bottom), or imported from an Excel file
   (the names column is identified automatically). After grading, each
   sheet's section and name are checked against these lists on the
   Results and Student Result pages.
   ============================================================ */

import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage, showConfirm } from '@/services/dialog.js'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/PaginationBar.vue'
import { formatDateTime } from '@/services/datetime.js'
import { displayGrade, gradeHeader, gradeSuffix } from '@/services/gradingScale.js'
import { exportSectionReportToFile } from '@/services/export.js'

const router = useRouter()
const store = useAppStore()

const sections = ref([])
const selectedSectionId = ref(null)
const students = ref([])
const loading = ref(true)

const newSectionName = ref('')
const newStudentName = ref('')
const editingSectionId = ref(null)
const editingSectionName = ref('')
const editingStudentId = ref(null)
const editingStudentName = ref('')

const busy = ref(false)
const importing = ref('')
const notice = ref('')
const imageInput = ref(null)
const excelInput = ref(null)
const exportingReport = ref(false)

const selectedSection = computed(() => sections.value.find((s) => s.section_id === selectedSectionId.value) || null)

const sectionsPaging = usePagination(sections)
const pagedSections = computed(() => sectionsPaging.pageItems.value)
// Jump the sidebar to wherever the selected section actually is -- creating
// or picking one should never make it seem to disappear onto another page.
watch(selectedSectionId, (id) => {
  const index = sections.value.findIndex((section) => section.section_id === id)
  if (index >= 0) sectionsPaging.goToPage(Math.floor(index / sectionsPaging.pageSize.value) + 1)
})

const studentsPaging = usePagination(students)
const pagedStudents = computed(() => studentsPaging.pageItems.value)
watch(selectedSectionId, () => studentsPaging.reset())

async function loadSections() {
  sections.value = await API.listSections()
  if (!sections.value.some((s) => s.section_id === selectedSectionId.value)) {
    selectedSectionId.value = sections.value[0]?.section_id ?? null
  }
}

async function loadStudents() {
  students.value = selectedSectionId.value ? await API.listSectionStudents(selectedSectionId.value) : []
}

async function refresh() {
  await loadSections()
  await loadStudents()
}

onMounted(async () => {
  try {
    await refresh()
  } finally {
    loading.value = false
  }
})

async function selectSection(sectionId) {
  selectedSectionId.value = sectionId
  notice.value = ''
  editingStudentId.value = null
  await loadStudents()
}

async function fail(title, error) {
  await showMessage(title, error?.message || 'Something went wrong. Please try again.')
}

async function createSection() {
  const name = newSectionName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const created = await API.createSection(name)
    newSectionName.value = ''
    await loadSections()
    await selectSection(created.section_id)
  } catch (error) {
    await fail('Section Not Added', error)
  } finally {
    busy.value = false
  }
}

function startRenameSection(section) {
  editingSectionId.value = section.section_id
  editingSectionName.value = section.name
}

async function saveRenameSection(section) {
  const name = editingSectionName.value.trim()
  if (!name) return
  try {
    await API.renameSection(section.section_id, name)
    editingSectionId.value = null
    await loadSections()
    await loadStudents()
  } catch (error) {
    await fail('Section Not Renamed', error)
  }
}

async function removeSection(section) {
  const ok = await showConfirm(
    'Delete Section?',
    `Delete ${section.name} and its ${section.student_count} student(s)? Graded sheets keep their recorded names but are no longer checked against this list.`,
  )
  if (!ok) return
  try {
    await API.deleteSection(section.section_id)
    await loadSections()
    await loadStudents()
  } catch (error) {
    await fail('Section Not Deleted', error)
  }
}

async function addStudent() {
  const name = newStudentName.value.trim()
  if (!name || !selectedSectionId.value || busy.value) return
  busy.value = true
  try {
    await API.addSectionStudent(selectedSectionId.value, name)
    newStudentName.value = ''
    await loadStudents()
    await loadSections()
    studentsPaging.goToPage(studentsPaging.pageCount.value) // the new student is appended last
  } catch (error) {
    await fail('Student Not Added', error)
  } finally {
    busy.value = false
  }
}

function startEditStudent(student) {
  editingStudentId.value = student.roster_id
  editingStudentName.value = student.full_name
}

async function saveEditStudent(student) {
  const name = editingStudentName.value.trim()
  if (!name) return
  try {
    await API.renameSectionStudent(student.roster_id, name)
    editingStudentId.value = null
    await loadStudents()
  } catch (error) {
    await fail('Student Not Updated', error)
  }
}

async function removeStudent(student) {
  const ok = await showConfirm('Remove Student?', `Remove ${student.full_name} from ${selectedSection.value?.name}?`)
  if (!ok) return
  try {
    await API.deleteSectionStudent(student.roster_id)
    await loadStudents()
    await loadSections()
  } catch (error) {
    await fail('Student Not Removed', error)
  }
}

async function exportSectionReport() {
  if (!selectedSection.value || exportingReport.value) return
  exportingReport.value = true
  try {
    await exportSectionReportToFile(selectedSection.value.name, students.value)
  } catch (error) {
    await fail('Report Not Exported', error)
  } finally {
    exportingReport.value = false
  }
}

/* ---------- Viewing one student's graded history ---------- */
const recordsStudent = ref(null)
const records = ref([])
const loadingRecords = ref(false)
const selectedRecordIds = ref(new Set())
const deletingRecords = ref(false)
const shown = (percentage) => displayGrade(percentage, store.gradingScale)
const suffix = computed(() => gradeSuffix(store.gradingScale))
const scoreHeader = computed(() => gradeHeader(store.gradingScale))

const selectedRecords = computed(() => records.value.filter((record) => selectedRecordIds.value.has(record.sheet_id)))
const allRecordsSelected = computed(() => records.value.length > 0 && selectedRecords.value.length === records.value.length)
const partiallyRecordsSelected = computed(() => selectedRecords.value.length > 0 && !allRecordsSelected.value)

function toggleAllRecords() {
  selectedRecordIds.value = allRecordsSelected.value ? new Set() : new Set(records.value.map((record) => record.sheet_id))
}
function toggleRecord(sheetId) {
  const next = new Set(selectedRecordIds.value)
  if (next.has(sheetId)) next.delete(sheetId)
  else next.add(sheetId)
  selectedRecordIds.value = next
}

async function viewRecords(student) {
  recordsStudent.value = student
  loadingRecords.value = true
  selectedRecordIds.value = new Set()
  try {
    records.value = await API.rosterStudentResults(student.roster_id)
  } catch (error) {
    await fail('Records Not Loaded', error)
    recordsStudent.value = null
  } finally {
    loadingRecords.value = false
  }
}

function closeRecords() {
  recordsStudent.value = null
  records.value = []
  selectedRecordIds.value = new Set()
}

function openRecord(record) {
  store.currentSessionId = record.session_id
  store.selectedStudentResultId = record.sheet_id
  router.push({ name: 'student_result' })
}

async function deleteSelectedRecords() {
  if (!selectedRecords.value.length || deletingRecords.value) return
  const targets = [...selectedRecords.value]
  const count = targets.length
  if (!await showConfirm(
    'Delete Selected Submissions',
    `Permanently delete ${count} graded record${count === 1 ? '' : 's'} for ${recordsStudent.value.full_name}? `
      + `This removes ${count === 1 ? 'its' : 'their'} answers, score, and stored images. This cannot be undone.`,
  )) return

  deletingRecords.value = true
  const failures = []
  try {
    for (const record of targets) {
      try {
        await API.deleteSheet(record.sheet_id)
        if (store.selectedStudentResultId === record.sheet_id) store.selectedStudentResultId = null
      } catch (error) {
        failures.push(error.message || String(error))
      }
    }
    records.value = await API.rosterStudentResults(recordsStudent.value.roster_id)
    selectedRecordIds.value = new Set()
    await loadStudents()
    if (failures.length) {
      await showMessage('Some Submissions Were Not Deleted', `${count - failures.length} of ${count} deleted. ${failures.join(' ')}`)
    }
  } finally {
    deletingRecords.value = false
  }
}

function reportImport(result, sourceLabel) {
  const parts = []
  parts.push(`Added ${result.added.length} student(s) from ${sourceLabel}, in the order they appear.`)
  if (result.skipped_duplicates?.length) {
    parts.push(`Skipped ${result.skipped_duplicates.length} already on this list: ${result.skipped_duplicates.join(', ')}.`)
  }
  parts.push('Check the list below and correct any misread name before grading.')
  notice.value = parts.join(' ')
}

async function importFromImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !selectedSectionId.value) return
  importing.value = 'Reading the list photo. This can take a minute on a large list...'
  try {
    const result = await API.importStudentsFromImage(selectedSectionId.value, file)
    reportImport(result, 'the photo')
    await loadStudents()
    await loadSections()
    studentsPaging.goToPage(studentsPaging.pageCount.value) // imported names land at the end, in order
  } catch (error) {
    await fail('Photo Not Imported', error)
  } finally {
    importing.value = ''
  }
}

async function importFromExcel(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !selectedSectionId.value) return
  importing.value = 'Reading the Excel file...'
  try {
    const result = await API.importStudentsFromExcel(selectedSectionId.value, file)
    reportImport(result, `${result.column} of the Excel file`)
    await loadStudents()
    await loadSections()
    studentsPaging.goToPage(studentsPaging.pageCount.value) // imported names land at the end, in order
  } catch (error) {
    await fail('Excel File Not Imported', error)
  } finally {
    importing.value = ''
  }
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Students</div>
      <div class="page-subtitle">
        Add the sections you handle, then the students in each section. Graded sheets are checked against these lists.
      </div>
    </div>

    <p v-if="loading" class="muted-text">Loading your sections...</p>

    <div v-else class="students-layout">
      <section class="card" aria-labelledby="sections-title">
        <div id="sections-title" class="card-title">Sections</div>
        <form class="flex gap-12 flex-wrap mt-8" @submit.prevent="createSection">
          <label class="sr-only" for="new-section">New section name</label>
          <input id="new-section" v-model="newSectionName" type="text" maxlength="50" placeholder="e.g. BSCS 1-A">
          <button type="submit" class="btn btn-primary" :disabled="!newSectionName.trim() || busy">Add Section</button>
        </form>

        <p v-if="!sections.length" class="muted-text mt-14">No sections yet. Add the first one above.</p>
        <ul v-else class="section-list">
          <li v-for="section in pagedSections" :key="section.section_id" :class="{ active: section.section_id === selectedSectionId }">
            <template v-if="editingSectionId === section.section_id">
              <label class="sr-only" :for="`rename-section-${section.section_id}`">Section name</label>
              <input :id="`rename-section-${section.section_id}`" v-model="editingSectionName" type="text" maxlength="50">
              <div class="flex gap-8 mt-8">
                <button type="button" class="btn btn-primary btn-small" @click="saveRenameSection(section)">Save</button>
                <button type="button" class="btn btn-secondary btn-small" @click="editingSectionId = null">Cancel</button>
              </div>
            </template>
            <template v-else>
              <button type="button" class="section-select" :aria-current="section.section_id === selectedSectionId" @click="selectSection(section.section_id)">
                <strong>{{ section.name }}</strong>
                <span class="muted-text">{{ section.student_count }} student(s)</span>
              </button>
              <div class="flex gap-8 mt-8">
                <button type="button" class="btn btn-secondary btn-small" @click="startRenameSection(section)">Rename</button>
                <button type="button" class="btn btn-danger btn-small" @click="removeSection(section)">Delete</button>
              </div>
            </template>
          </li>
        </ul>
        <PaginationBar
          v-model:page="sectionsPaging.page.value"
          v-model:page-size="sectionsPaging.pageSize.value"
          :page-count="sectionsPaging.pageCount.value"
          :total="sectionsPaging.total.value"
          :range-start="sectionsPaging.rangeStart.value"
          :range-end="sectionsPaging.rangeEnd.value"
          item-label="section"
        />
      </section>

      <section class="card" aria-labelledby="students-title">
        <template v-if="selectedSection">
          <div id="students-title" class="card-title">{{ selectedSection.name }}</div>
          <p class="muted-text">{{ students.length }} student(s), in the order shown.</p>

          <form class="flex gap-8 flex-wrap mt-8" @submit.prevent="addStudent">
            <label class="sr-only" for="new-student">Student name</label>
            <input id="new-student" v-model="newStudentName" type="text" maxlength="150" placeholder="Full name, as on the class list">
            <button type="submit" class="btn btn-primary" :disabled="!newStudentName.trim() || busy">Add Student</button>
          </form>

          <div class="flex gap-8 flex-wrap mt-8">
            <button type="button" class="btn btn-secondary" :disabled="!!importing" @click="imageInput?.click()">
              Import from Photo of List
            </button>
            <button type="button" class="btn btn-secondary" :disabled="!!importing" @click="excelInput?.click()">
              Import from Excel (.xlsx)
            </button>
            <input ref="imageInput" type="file" accept="image/*,.heic,.heif" hidden @change="importFromImage">
            <input ref="excelInput" type="file" accept=".xlsx" hidden @change="importFromExcel">
            <button type="button" class="btn btn-success" :disabled="exportingReport || !students.length" @click="exportSectionReport">
              {{ exportingReport ? 'Exporting...' : 'Export Section Report' }}
            </button>
          </div>
          <p v-if="importing" class="muted-text mt-8" role="status">{{ importing }}</p>
          <p v-if="notice" class="notice mt-8" role="status">{{ notice }}</p>

          <div class="table-wrapper mt-8">
            <table>
              <thead>
                <tr><th>#</th><th>Full Name</th><th>Actions</th></tr>
              </thead>
              <tbody>
                <tr v-for="(student, index) in pagedStudents" :key="student.roster_id">
                  <td>{{ studentsPaging.rangeStart.value + index }}</td>
                  <td>
                    <template v-if="editingStudentId === student.roster_id">
                      <label class="sr-only" :for="`edit-student-${student.roster_id}`">Student name</label>
                      <input :id="`edit-student-${student.roster_id}`" v-model="editingStudentName" type="text" maxlength="150">
                    </template>
                    <template v-else>{{ student.full_name }}</template>
                  </td>
                  <td>
                    <div class="flex gap-8 flex-wrap">
                      <template v-if="editingStudentId === student.roster_id">
                        <button type="button" class="btn btn-primary btn-small" @click="saveEditStudent(student)">Save</button>
                        <button type="button" class="btn btn-secondary btn-small" @click="editingStudentId = null">Cancel</button>
                      </template>
                      <template v-else>
                        <button type="button" class="btn btn-secondary btn-small" @click="viewRecords(student)">View Records</button>
                        <button type="button" class="btn btn-secondary btn-small" @click="startEditStudent(student)">Edit</button>
                        <button type="button" class="btn btn-danger btn-small" @click="removeStudent(student)">Remove</button>
                      </template>
                    </div>
                  </td>
                </tr>
                <tr v-if="!students.length">
                  <td colspan="3" class="table-empty">No students in this section yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <PaginationBar
            v-model:page="studentsPaging.page.value"
            v-model:page-size="studentsPaging.pageSize.value"
            :page-count="studentsPaging.pageCount.value"
            :total="studentsPaging.total.value"
            :range-start="studentsPaging.rangeStart.value"
            :range-end="studentsPaging.rangeEnd.value"
            item-label="student"
          />
        </template>
        <p v-else class="muted-text">Add a section on the left to start its student list.</p>
      </section>
    </div>

    <div v-if="recordsStudent" class="toast-overlay" @click.self="closeRecords">
      <div class="toast-box records-box" role="dialog" aria-modal="true" aria-labelledby="records-title">
        <div id="records-title" class="toast-title">{{ recordsStudent.full_name }} — Graded History</div>
        <p v-if="loadingRecords" class="muted-text">Loading...</p>
        <template v-else>
          <p v-if="!records.length" class="muted-text">No graded sheets are linked to this student yet.</p>
          <div v-else class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all records" :checked="allRecordsSelected" :indeterminate="partiallyRecordsSelected" :disabled="deletingRecords" @change="toggleAllRecords"></th>
                  <th>Date</th><th>Questionnaire</th><th>Score</th><th>{{ scoreHeader }}</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in records" :key="record.sheet_id" :class="{ selected: selectedRecordIds.has(record.sheet_id) }">
                  <td><input type="checkbox" :aria-label="`Select record from ${formatDateTime(record.created_at)}`" :checked="selectedRecordIds.has(record.sheet_id)" :disabled="deletingRecords" @change="toggleRecord(record.sheet_id)"></td>
                  <td>{{ formatDateTime(record.created_at) }}</td>
                  <td>{{ record.answer_key_name || 'No questionnaire' }}</td>
                  <td>{{ record.score }} / {{ record.total }}</td>
                  <td>{{ shown(record.percentage) }}{{ suffix }}</td>
                  <td>
                    <span class="badge" :class="record.status === 'Flagged' ? 'badge-warning' : 'badge-success'">
                      {{ record.status }}
                    </span>
                  </td>
                  <td><button type="button" class="btn btn-secondary btn-small" @click="openRecord(record)">View</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <div class="toast-actions">
          <span v-if="selectedRecords.length" class="badge badge-gray">{{ selectedRecords.length }} selected</span>
          <button
            v-if="records.length"
            type="button"
            class="btn btn-danger"
            :disabled="!selectedRecords.length || deletingRecords"
            @click="deleteSelectedRecords"
          >
            {{ deletingRecords ? 'Deleting...' : `Delete Selected${selectedRecords.length ? ` (${selectedRecords.length})` : ''}` }}
          </button>
          <button type="button" class="btn btn-secondary" @click="closeRecords">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.students-layout { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; gap: 16px; align-items: start; }
.section-list { list-style: none; padding: 0; margin: 0; margin-top: 14px; display: grid; gap: 10px; }
.section-list li { border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 10px; padding: 10px; }
.section-list li.active { border-color: currentColor; }
.section-select { width: 100%; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; color: inherit; display: grid; gap: 2px; }
.notice { border-left: 4px solid currentColor; padding: 8px 12px; }
.records-box { min-width: 320px; max-width: 720px; width: 100%; }
@media (max-width: 760px) {
  .students-layout { grid-template-columns: 1fr; }
}
</style>
