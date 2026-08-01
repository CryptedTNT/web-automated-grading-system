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

function reload(selectKeyId) {
  keys.value = DB.answerKeys()
  const targetId = selectKeyId || currentKeyId.value || keys.value[0]?.id || null
  if (targetId && !creatingNew.value) loadKey(targetId)
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
}

function newKey() {
  creatingNew.value = true
  currentKeyId.value = null
  selectedRow.value = null
  keyName.value = `Answer Key ${keys.value.length + 1}`
  rows.value = Array.from({ length: 5 }, (_, i) =>
    makeRow([i + 1, 'Multiple Choice', '', 'A', '', 1, 85]),
  )
}

function addRow() {
  rows.value.push(makeRow())
}

function deleteRow() {
  if (!rows.value.length) return
  const index = rows.value.findIndex((r) => r.uid === selectedRow.value)
  rows.value.splice(index >= 0 ? index : rows.value.length - 1, 1)
  selectedRow.value = null
}

/* Mirrors _collectItems(): rows without a correct answer are skipped,
   and a group number is only kept for Enumeration items. */
function collectItems() {
  const items = []
  rows.value.forEach((row, i) => {
    const correct = String(row.correct).trim()
    if (!correct) return

    const group = String(row.group).trim()
    let enumGroup = group ? parseInt(group) : null
    if (isNaN(enumGroup)) throw new Error(`Invalid group number in row ${i + 1}.`)
    if (!row.type.toLowerCase().includes('enumeration')) enumGroup = null

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
  reload(keyId)
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
            @click="loadKey(key.id)"
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
