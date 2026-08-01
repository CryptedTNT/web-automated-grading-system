<script setup>
/* ============================================================
   UploadView.vue — image and folder upload queue
   Ported from js/upload.js.

   Entries are normalized on the way in (see normalizeEntry) and kept
   in store.uploadFiles, which Processing reads. The browser File
   object rides along on entry.file; Vue leaves File instances
   un-proxied, so it stays usable once the OCR model is connected.
   ============================================================ */

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'

const router = useRouter()
const store = useAppStore()

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'])

const fileInput = ref(null)
const folderInput = ref(null)
const dragOver = ref(false)

const answerKeys = computed(() => DB.answerKeys())
const files = computed(() => store.uploadFiles)

const selectedKeyId = computed({
  get: () => store.selectedAnswerKeyId,
  set: (value) => {
    store.selectedAnswerKeyId = parseInt(value) || null
  },
})

/* Fall back to the first key if the stored selection no longer exists. */
onMounted(() => {
  const keys = answerKeys.value
  if (!keys.some((key) => key.id === store.selectedAnswerKeyId)) {
    store.selectedAnswerKeyId = keys[0]?.id || null
  }
})

const totalBytes = computed(() => files.value.reduce((sum, entry) => sum + entry.size, 0))

const folderCount = computed(
  () => new Set(files.value.map((entry) => parentFolder(entry.relativePath)).filter(Boolean)).size,
)

function parentFolder(path) {
  const parts = String(path || '').split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

function extension(name) {
  const index = String(name).lastIndexOf('.')
  return index >= 0 ? String(name).slice(index).toLowerCase() : ''
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/* `key` is what de-duplicates the queue, and what Processing uses to
   notice that the batch changed. */
function normalizeEntry(file, source) {
  const name = String(file?.name || 'answer-sheet')
  const relativePath = String(file?.webkitRelativePath || name)
  const size = Number(file?.size) || 0
  const lastModified = Number(file?.lastModified) || 0
  return {
    key: `${relativePath.toLowerCase()}|${size}|${lastModified}`,
    file,
    name,
    size,
    type: String(file?.type || ''),
    lastModified,
    relativePath,
    source: source || 'Images',
  }
}

async function addFiles(incoming, source) {
  const existing = new Set(files.value.map((entry) => entry.key))
  const accepted = [...files.value]
  const unsupported = []
  let duplicateCount = 0

  incoming.forEach((file) => {
    const entry = normalizeEntry(file, source)
    if (!SUPPORTED_EXTENSIONS.has(extension(entry.name))) {
      unsupported.push(entry.name)
      return
    }
    if (existing.has(entry.key)) {
      duplicateCount += 1
      return
    }
    existing.add(entry.key)
    accepted.push(entry)
  })

  store.uploadFiles = accepted

  const messages = []
  if (unsupported.length) {
    const examples = unsupported.slice(0, 3).join(', ')
    messages.push(
      `${unsupported.length} unsupported file(s) skipped${examples ? `: ${examples}` : ''}.`,
    )
  }
  if (duplicateCount) messages.push(`${duplicateCount} duplicate file(s) skipped.`)
  if (messages.length) await showMessage('Upload Notice', messages.join(' '))
}

function onFilePicked(event, source) {
  addFiles(Array.from(event.target.files || []), source)
  event.target.value = '' // let the same file be picked again
}

function onDrop(event) {
  dragOver.value = false
  addFiles(Array.from(event.dataTransfer?.files || []), 'Drop')
}

function onDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) dragOver.value = false
}

/* Clicking the zone opens the picker, but not when a button inside
   it was the actual target. */
function openFilePicker(event) {
  if (event?.target?.closest?.('button')) return
  fileInput.value?.click()
}

function removeFile(index) {
  store.uploadFiles = files.value.filter((_, entryIndex) => entryIndex !== index)
}

function clearQueue() {
  store.uploadFiles = []
}

async function proceed() {
  const keyId = store.selectedAnswerKeyId
  if (!keyId) {
    await showMessage('Answer Key Required', 'Select or create an answer key before processing.')
    return
  }
  if (!DB.answerKeyItems(keyId).length) {
    await showMessage('Answer Key Is Empty', 'Add at least one valid item to the selected answer key.')
    return
  }
  if (!files.value.length) {
    await showMessage('Images Required', 'Add at least one supported answer sheet image.')
    return
  }
  router.push({ name: 'processing' })
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Upload Answer Sheets</div>
      <div class="page-subtitle">Prepare individual images or a class folder for processing.</div>
    </div>

    <div class="workflow-layout upload-layout">
      <aside class="card workflow-sidebar">
        <div class="card-title">Upload Setup</div>

        <div class="form-group">
          <label class="form-label" for="upload-key-combo">Answer Key</label>
          <select id="upload-key-combo" v-model="selectedKeyId">
            <option v-if="!answerKeys.length" :value="null">No answer keys available</option>
            <option v-for="key in answerKeys" :key="key.id" :value="key.id">{{ key.name }}</option>
          </select>
        </div>

        <button
          v-if="!answerKeys.length"
          class="btn btn-secondary w-full mb-14"
          @click="router.push({ name: 'answer_key' })"
        >
          Create Answer Key
        </button>

        <div class="queue-summary" aria-label="Upload queue summary">
          <div><span>Images</span><strong>{{ files.length }}</strong></div>
          <div><span>Total size</span><strong>{{ formatBytes(totalBytes) }}</strong></div>
          <div><span>Folders</span><strong>{{ folderCount }}</strong></div>
        </div>

        <div class="model-note mt-14">
          <span class="badge badge-blue">Model Pending</span>
          <p>
            Processing creates clearly labeled placeholder records until the OCR model is connected.
          </p>
        </div>
      </aside>

      <section class="card workflow-main">
        <div class="card-title">Batch Upload</div>

        <div
          class="drop-zone"
          :class="{ 'drag-over': dragOver }"
          role="button"
          tabindex="0"
          aria-label="Choose or drop answer sheet images"
          @click="openFilePicker"
          @keydown.enter.prevent="fileInput?.click()"
          @keydown.space.prevent="fileInput?.click()"
          @dragover.prevent="dragOver = true"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <div class="drop-icon" aria-hidden="true">+</div>
          <div class="drop-text">Drop answer sheet images here</div>
          <div class="muted-text">JPG, JPEG, PNG, BMP, TIF, and TIFF</div>
          <div class="flex gap-8 flex-wrap justify-center">
            <button type="button" class="btn btn-primary" @click.stop="fileInput?.click()">
              Browse Images
            </button>
            <button type="button" class="btn btn-secondary" @click.stop="folderInput?.click()">
              Browse Folder
            </button>
          </div>

          <input
            ref="fileInput"
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.bmp,.tif,.tiff"
            hidden
            @change="onFilePicked($event, 'Images')"
          >
          <input
            ref="folderInput"
            type="file"
            multiple
            webkitdirectory
            directory
            accept=".jpg,.jpeg,.png,.bmp,.tif,.tiff"
            hidden
            @change="onFilePicked($event, 'Folder')"
          >
        </div>

        <div class="queue-heading">
          <div>
            <div class="section-title">Selected Images</div>
            <div class="muted-text">
              {{ files.length ? `${files.length} image(s) ready for processing.` : 'No images selected.' }}
            </div>
          </div>
          <button
            type="button"
            class="btn btn-danger btn-small"
            :disabled="!files.length"
            @click="clearQueue"
          >
            Clear Queue
          </button>
        </div>

        <div class="file-list upload-file-list">
          <div v-if="!files.length" class="file-empty">
            Choose images to build the processing queue.
          </div>
          <div v-for="(entry, index) in files" :key="entry.key" class="file-item upload-file-row">
            <div class="upload-file-main">
              <strong>{{ entry.name }}</strong>
              <span>{{ entry.relativePath }}</span>
            </div>
            <span class="badge badge-gray">{{ entry.source }}</span>
            <span class="upload-file-size">{{ formatBytes(entry.size) }}</span>
            <button
              type="button"
              class="btn btn-secondary btn-small"
              :aria-label="`Remove ${entry.name}`"
              @click="removeFile(index)"
            >
              Remove
            </button>
          </div>
        </div>

        <div class="workflow-actions">
          <button type="button" class="btn btn-primary" @click="proceed">
            Proceed to Processing
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
