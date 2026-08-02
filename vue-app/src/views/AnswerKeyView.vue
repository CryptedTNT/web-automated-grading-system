<script setup>
/* ============================================================
   AnswerKeyView.vue — Answer Key CRUD + item table
   Ported from js/answer_key.js.
   ============================================================ */

import { ref, computed, onMounted } from 'vue'
import { DB } from '@/services/database.js'
import { showMessage, showConfirm } from '@/services/dialog.js'

const HEADERS = ['#', 'Type', 'Group', 'Correct Answer(s)', 'Alternative Answers', 'Points', 'Threshold']
const Q_TYPES = ['Multiple Choice', 'True or False', 'Identification', 'Enumeration']

const keys = ref([])
const currentKeyId = ref(null)
const creatingNew = ref(false)
const keyName = ref('')
const rows = ref([])
const selectedRow = ref(null)

/* v-for needs a stable key per row, and rows have no database id
   until they are saved — so each one carries a local uid. */
let nextUid = 1
function makeRow(values) {
  const [, type, group, correct, alternatives, points, threshold] =
    values || [0, 'Identification', '', '', '', 1, 85]
  return {
    uid: nextUid++,
    type: String(type),
    group: group ?? '',
    correct: correct ?? '',
    alternatives: alternatives ?? '',
    points: points ?? 1,
    threshold: threshold ?? 85,
  }
}

/* Serialized copy of the last saved (or freshly loaded) state. Comparing
   against it is what tells us the table has unsaved edits — without this
   the original replaced the whole table on a stray click in the sidebar
   and a teacher could lose twenty typed items with no warning. */
const savedSnapshot = ref('')

function snapshot() {
  return JSON.stringify({
    name: keyName.value.trim(),
    // uid is a local render key, not data — it must not count as a change.
    rows: rows.value.map(({ uid, ...fields }) => fields),
  })
}

const isDirty = computed(() => snapshot() !== savedSnapshot.value)

async function confirmDiscard() {
  if (!isDirty.value) return true
  return showConfirm(
    'Discard Unsaved Changes',
    'This answer key has unsaved changes. Discard them and continue?',
  )
}

function reload(selectKeyId) {
  keys.value = DB.answerKeys()
  const targetId = selectKeyId || currentKeyId.value || keys.value[0]?.id || null
  if (targetId && !creatingNew.value) loadKey(targetId)
  // Nothing to load (no keys yet, or the last one was just deleted):
  // baseline the snapshot so an untouched empty form is not "dirty".
  else savedSnapshot.value = snapshot()
}

function loadKey(keyId) {
  const key = keys.value.find((k) => k.id === keyId)
  if (!key) return
  creatingNew.value = false
  currentKeyId.value = keyId
  keyName.value = key.name
  selectedRow.value = null
  rows.value = DB.answerKeyItems(keyId).map((item) =>
    makeRow([
      item.item_no,
      item.type,
      item.enum_group ?? '',
      item.correct_answer,
      item.alternatives,
      item.points,
      item.fuzzy_threshold,
    ]),
  )
  savedSnapshot.value = snapshot()
}

/* Sidebar clicks go through here so unsaved work is never silently lost. */
async function selectKey(keyId) {
  if (keyId === currentKeyId.value && !creatingNew.value) return
  if (!(await confirmDiscard())) return
  loadKey(keyId)
}

/* Never reuse a name that already exists — `keys.length + 1` produced a
   duplicate as soon as a key in the middle of the list had been deleted,
   leaving two identical entries in the sidebar. */
function nextKeyName() {
  const taken = new Set(keys.value.map((key) => key.name))
  let n = keys.value.length + 1
  while (taken.has(`Answer Key ${n}`)) n += 1
  return `Answer Key ${n}`
}

async function newKey() {
  if (!(await confirmDiscard())) return
  creatingNew.value = true
  currentKeyId.value = null
  selectedRow.value = null
  keyName.value = nextKeyName()
  rows.value = Array.from({ length: 5 }, (_, i) =>
    makeRow([i + 1, 'Multiple Choice', '', 'A', '', 1, 85]),
  )
  savedSnapshot.value = snapshot()
}

function addRow() {
  rows.value.push(makeRow())
}

async function deleteRow() {
  if (!rows.value.length) return
  const index = rows.value.findIndex((r) => r.uid === selectedRow.value)
  /* Falling back to the last row meant a misplaced click silently deleted
     work the teacher never pointed at. */
  if (index < 0) {
    await showMessage('No Row Selected', 'Click the item row you want to delete first.')
    return
  }
  rows.value.splice(index, 1)
  selectedRow.value = null
}

/* Mirrors _collectItems(): rows without a correct answer are skipped,
   and a group number is only kept for Enumeration items. */
function collectItems() {
  const items = []
  rows.value.forEach((row, i) => {
    const correct = String(row.correct).trim()
    if (!correct) return

    /* The group only means anything for Enumeration, so discard it for
       every other type *before* validating — otherwise a stray note in
       the Group cell of a Multiple Choice row blocked the whole save
       over a value that was about to be thrown away. */
    const isEnumeration = row.type.toLowerCase().includes('enumeration')
    const group = String(row.group).trim()
    let enumGroup = null
    if (isEnumeration && group) {
      enumGroup = parseInt(group)
      if (isNaN(enumGroup)) throw new Error(`Invalid group number in row ${i + 1}.`)
    }

    items.push({
      item_no: items.length + 1,
      type: row.type || 'Identification',
      enum_group: enumGroup,
      correct_answer: correct,
      alternatives: String(row.alternatives).trim(),
      points: parseFloat(row.points) || 1,
      fuzzy_threshold: parseInt(row.threshold) || 85,
    })
  })
  return items
}

async function saveKey() {
  const name = keyName.value.trim() || 'Untitled Answer Key'

  let items
  try {
    items = collectItems()
  } catch (e) {
    showMessage('Invalid Answer Key', e.message)
    return
  }
  if (!items.length) {
    showMessage('No Items', 'Add at least one answer key item before saving.')
    return
  }

  let keyId
  if (currentKeyId.value === null || creatingNew.value) {
    keyId = DB.createAnswerKey(name, '')
  } else {
    keyId = currentKeyId.value
    DB.updateAnswerKey(keyId, name, '')
  }
  DB.replaceAnswerKeyItems(keyId, items)

  creatingNew.value = false
  currentKeyId.value = keyId
  await showMessage('Saved', 'Answer key saved.')
  reload(keyId) // reloads from storage and refreshes the dirty snapshot
}

async function deleteAnswerKey() {
  if (currentKeyId.value === null) {
    showMessage('No Answer Key Selected', 'Select an answer key to delete.')
    return
  }
  const yes = await showConfirm('Delete Answer Key', 'Delete this answer key? This cannot be undone.')
  if (!yes) return

  DB.deleteAnswerKey(currentKeyId.value)
  currentKeyId.value = null
  keyName.value = ''
  rows.value = []
  savedSnapshot.value = snapshot() // the emptied form is not "unsaved work"
  reload()
}

const hasKeys = computed(() => keys.value.length > 0)

onMounted(reload)
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Answer Key Management</div>
      <div class="page-subtitle">Create, save, and reuse answer keys.</div>
    </div>

    <div class="workflow-layout">
      <div class="card workflow-sidebar">
        <div class="card-title">Saved Answer Keys</div>
        <button class="btn btn-primary w-full mb-8" title="Create a new answer key." @click="newKey">
          + New Answer Key
        </button>

        <div class="list-widget">
          <div
            v-for="key in keys"
            :key="key.id"
            class="list-item"
            :class="{ active: key.id === currentKeyId }"
            @click="selectKey(key.id)"
          >
            {{ key.name }}
          </div>
          <div v-if="!hasKeys" class="list-item muted-text">No answer keys yet.</div>
        </div>

        <button
          class="btn btn-danger w-full mt-8"
          title="Delete the selected answer key."
          @click="deleteAnswerKey"
        >
          Delete Answer Key
        </button>
      </div>

      <div class="card workflow-main">
        <div class="card-title">Answer Key Details</div>

        <div class="form-group">
          <label class="form-label">Answer Key Name</label>
          <input
            v-model="keyName"
            type="text"
            title="Enter a descriptive name for this answer key."
          >
        </div>

        <div class="table-wrapper" style="max-height:400px; overflow-y:auto;">
          <table>
            <thead>
              <tr><th v-for="header in HEADERS" :key="header">{{ header }}</th></tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in rows"
                :key="row.uid"
                :class="{ selected: row.uid === selectedRow }"
                @click="selectedRow = row.uid"
              >
                <td style="text-align:center;font-weight:700;">{{ index + 1 }}</td>
                <td>
                  <select v-model="row.type" title="Question type">
                    <option v-for="type in Q_TYPES" :key="type">{{ type }}</option>
                  </select>
                </td>
                <td>
                  <input
                    v-model="row.group"
                    type="text"
                    style="text-align:center;width:60px;"
                    title="Enumeration group number"
                  >
                </td>
                <td><input v-model="row.correct" type="text" title="Correct answer(s)"></td>
                <td><input v-model="row.alternatives" type="text" title="Alternative answers"></td>
                <td>
                  <input
                    v-model.number="row.points"
                    type="number"
                    style="text-align:center;width:60px;"
                    title="Points"
                  >
                </td>
                <td>
                  <input
                    v-model.number="row.threshold"
                    type="number"
                    style="text-align:center;width:70px;"
                    title="Fuzzy match threshold %"
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex gap-8 mt-8 items-center">
          <button class="btn btn-secondary" title="Add another item row." @click="addRow">Add Item</button>
          <button class="btn btn-danger" title="Delete the selected item row." @click="deleteRow">Delete Row</button>
          <div class="spacer"></div>
          <button class="btn btn-primary" title="Save the answer key." @click="saveKey">Save Key</button>
        </div>
      </div>
    </div>
  </div>
</template>
