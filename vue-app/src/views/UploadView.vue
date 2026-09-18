<script setup>
/* ============================================================
   UploadView.vue — image, folder, and live-capture upload queue
   Ported from js/upload.js; extended (see plan for "multi-page exam
   sheets") to group pages into one submission per student instead of
   one submission per image.

   store.uploadFiles now holds GROUPS, not a flat file list:
     { key, label, source: 'Images'|'Folder'|'Camera', pages: [entry, ...] }
   Each `entry` is the same per-file shape normalizeEntry() always
   produced (key/file/name/size/type/lastModified/relativePath/source).
   Processing (stores/processing.js) uploads one group per request via
   API.uploadSheetGroup(), so a group is what ends up as one exam_sheet
   row server-side (see backend/app/routers/sessions.py).

   Grouping rule, no paper changes needed for any of it:
   - Folder browsing: one group per distinct parent folder (a teacher
     drops each student's pages into their own subfolder).
   - Flat images/drop: chunked into consecutive groups of N, where N is
     the "Pages per student" field below.
   - Capture Live: the wizard builds one already-ordered group per
     student directly, page by page, so there is no grouping ambiguity
     at all for that path.
   A Review Groups section lets the teacher fix a stray/misplaced page
   before processing starts, regardless of which path produced it.
   ============================================================ */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage, showConfirm } from '@/services/dialog.js'
import LegalDocumentLink from '@/components/LegalDocumentLink.vue'

const router = useRouter()
const store = useAppStore()

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'])

const fileInput = ref(null)
const folderInput = ref(null)
const dragOver = ref(false)

// The webkitdirectory/directory attributes in the template below don't
// reliably switch the native picker into folder-selection mode on their
// own in every environment -- when that happens, the browser silently
// falls back to a plain multi-file dialog (title says "Open" instead of
// "Select Folder"), and there is no way to pick a whole folder at all.
// Setting the same two as real DOM/IDL properties, not just HTML
// attributes, on mount is the standard, more reliable workaround.
onMounted(() => {
  if (folderInput.value) {
    folderInput.value.webkitdirectory = true
    folderInput.value.directory = true
  }
})

/* File System Access API: a real, dedicated directory-chooser dialog
   with no "is this actually in folder mode" ambiguity at all -- unlike
   <input webkitdirectory>, whose picker sometimes silently falls back
   to a plain single-file "Open" dialog (confirmed happening on a real
   Windows/Chrome setup: the recursive walk below is what actually reads
   every file in every subfolder in that case, in exactly the nested
   Student1/Student2-style layout this app expects). Support is limited
   to Chromium browsers, so the classic <input webkitdirectory> stays as
   the fallback for everyone else. */
const supportsDirectoryPicker = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

async function collectDirectoryFiles(dirHandle, pathPrefix) {
  const collected = []
  for await (const [name, handle] of dirHandle.entries()) {
    const relativePath = `${pathPrefix}/${name}`
    if (handle.kind === 'file') {
      const file = await handle.getFile()
      collected.push({ file, relativePath })
    } else if (handle.kind === 'directory') {
      collected.push(...(await collectDirectoryFiles(handle, relativePath)))
    }
  }
  return collected
}

async function browseFolder() {
  if (!supportsDirectoryPicker) {
    folderInput.value?.click()
    return
  }
  let dirHandle
  try {
    dirHandle = await window.showDirectoryPicker()
  } catch (error) {
    if (error?.name === 'AbortError') return // teacher cancelled -- not a failure
    // Something about the modern API itself failed (permission prompt
    // dismissed oddly, etc.) -- fall back rather than dead-ending here.
    folderInput.value?.click()
    return
  }
  const entries = await collectDirectoryFiles(dirHandle, dirHandle.name)
  await addFiles(entries, 'Folder')
}

const answerKeys = ref([])

const groups = computed({
  get: () => store.uploadFiles,
  set: (value) => { store.uploadFiles = value },
})

const selectedKeyId = computed({
  get: () => store.selectedAnswerKeyId,
  set: (value) => {
    store.selectedAnswerKeyId = parseInt(value) || null
  },
})

/* Required attestation that paper consent (the downloadable form in
   Settings) was already collected for every student in this queue --
   this is what gets sent with the upload and is what
   student_info.consent_status actually records, instead of the column
   being hardcoded true regardless of whether consent was ever asked
   for. Resets with every new queue (see stores/app.js), so it can't be
   checked once and forgotten across unrelated batches. */
const consentConfirmed = computed({
  get: () => store.consentConfirmed,
  set: (value) => { store.consentConfirmed = value },
})

/* Fall back to the first key if the stored selection no longer exists. */
onMounted(async () => {
  answerKeys.value = await API.answerKeys()
  if (!answerKeys.value.some((key) => key.id === store.selectedAnswerKeyId)) {
    store.selectedAnswerKeyId = answerKeys.value[0]?.id || null
  }
})

/* How many physical pages make up one student's submission for this
   batch. Only drives the *initial* grouping of flat/camera uploads --
   folders always group by folder regardless, and Review Groups can fix
   any group by hand no matter how it was produced. */
const pagesPerStudent = ref(1)

const totalPages = computed(() => groups.value.reduce((sum, group) => sum + group.pages.length, 0))
const totalBytes = computed(() =>
  groups.value.reduce((sum, group) => sum + group.pages.reduce((s, entry) => s + entry.size, 0), 0),
)
const folderCount = computed(() => groups.value.filter((group) => group.source === 'Folder').length)

function isMismatched(group) {
  return group.pages.length !== (parseInt(pagesPerStudent.value) || 1)
}
const anyMismatched = computed(() => groups.value.some(isMismatched))

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

let groupCounter = 0
function nextGroupKey() {
  groupCounter += 1
  return `group-${Date.now()}-${groupCounter}`
}

/* `key` is what de-duplicates the queue, and what Processing uses to
   notice that the batch changed. `relativePathOverride` is used by the
   showDirectoryPicker() path below -- files it returns via
   FileSystemFileHandle.getFile() have no webkitRelativePath at all
   (that property only exists on File objects that came from an
   <input webkitdirectory> picker), so the folder-relative path has to
   be supplied explicitly instead of read off the file. */
function normalizeEntry(file, source, relativePathOverride) {
  const name = String(file?.name || 'answer-sheet')
  const relativePath = String(relativePathOverride || file?.webkitRelativePath || name)
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

/* `incoming` is normally a plain array of File objects -- but when
   called from the showDirectoryPicker() path, each entry is instead
   {file, relativePath} (see normalizeEntry's comment above for why). */
async function addFiles(incoming, source) {
  const existingKeys = new Set(groups.value.flatMap((group) => group.pages.map((entry) => entry.key)))
  const accepted = []
  const unsupported = []
  let duplicateCount = 0

  incoming.forEach((item) => {
    const file = item instanceof File ? item : item?.file
    const entry = normalizeEntry(file, source, item?.relativePath)
    if (!SUPPORTED_EXTENSIONS.has(extension(entry.name))) {
      unsupported.push(entry.name)
      return
    }
    if (existingKeys.has(entry.key)) {
      duplicateCount += 1
      return
    }
    existingKeys.add(entry.key)
    accepted.push(entry)
  })

  if (accepted.length) {
    const newGroups = source === 'Folder' ? groupByFolder(accepted) : chunkFlat(accepted)
    groups.value = [...groups.value, ...newGroups]
  }

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

/* One group per distinct parent folder -- a teacher who drops each
   student's photos into their own subfolder gets correct grouping with
   no other convention needed. Pages within a folder sort by filename. */
function groupByFolder(entries) {
  const byFolder = new Map()
  for (const entry of entries) {
    const folder = parentFolder(entry.relativePath) || entry.relativePath
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder).push(entry)
  }
  const result = []
  for (const [folder, pages] of byFolder) {
    pages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    result.push({ key: nextGroupKey(), label: folder, source: 'Folder', pages })
  }
  return result
}

/* Flat images (browsed or dropped): chunked into consecutive groups of
   `pagesPerStudent`, in the order given. */
function chunkFlat(entries) {
  const size = Math.max(1, parseInt(pagesPerStudent.value) || 1)
  const result = []
  for (let i = 0; i < entries.length; i += size) {
    result.push({
      key: nextGroupKey(),
      label: `Submission ${groups.value.length + result.length + 1}`,
      source: entries[0]?.source || 'Images',
      pages: entries.slice(i, i + size),
    })
  }
  return result
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

function clearQueue() {
  groups.value = []
}

/* ---------------------------------------------------------- Review Groups */

function removePage(groupIndex, pageIndex) {
  const next = groups.value.map((group, index) => {
    if (index !== groupIndex) return group
    return { ...group, pages: group.pages.filter((_, i) => i !== pageIndex) }
  })
  groups.value = next.filter((group) => group.pages.length > 0)
}

/* `group.label` for Folder groups is the real folder name (stable,
   worth keeping as-is). For Images/Camera groups it was set once at
   creation time as "Group N", which goes stale the moment any group
   before it is removed -- N was never anyone's live position, just
   whatever the queue length happened to be at that instant. Displaying
   groupIndex + 1 here instead means the numbering always matches what's
   actually on screen, including right after a removal. */
function displayGroupLabel(group, index) {
  if (group.source === 'Folder') return group.label
  return group.source === 'Camera' ? `Submission ${index + 1} (captured)` : `Submission ${index + 1}`
}

async function deleteGroup(groupIndex) {
  const group = groups.value[groupIndex]
  if (!group) return
  const ok = await showConfirm(
    'Remove Submission?',
    `Remove "${displayGroupLabel(group, groupIndex)}" and its ${group.pages.length} page(s) from the queue?`,
  )
  if (!ok) return
  groups.value = groups.value.filter((_, index) => index !== groupIndex)
}

/* Moves one page to another existing group, or a brand-new one. Lets
   the teacher fix a stray photo that landed in the wrong bucket
   without having to remove and re-add it from scratch. */
function movePage(groupIndex, pageIndex, targetKey) {
  const source = groups.value[groupIndex]
  if (!source) return
  const entry = source.pages[pageIndex]
  if (!entry) return

  let next = groups.value.map((group, index) => {
    if (index !== groupIndex) return group
    return { ...group, pages: group.pages.filter((_, i) => i !== pageIndex) }
  })
  next = next.filter((group) => group.pages.length > 0)

  if (targetKey === '__new__') {
    next = [...next, { key: nextGroupKey(), label: `Submission ${next.length + 1}`, source: source.source, pages: [entry] }]
  } else {
    next = next.map((group) => (group.key === targetKey ? { ...group, pages: [...group.pages, entry] } : group))
  }
  groups.value = next
}

/* Reorders pages WITHIN one submission -- distinct from movePage() above,
   which moves a page BETWEEN submissions. Picking "Page 2" for the page
   currently in position 1 swaps them, so page order (which matters --
   only page 1 is expected to carry the Name/Section header) can be
   corrected without removing and re-adding anything. */
function swapPages(groupIndex, fromIndex, toIndex) {
  if (fromIndex === toIndex) return
  groups.value = groups.value.map((group, index) => {
    if (index !== groupIndex) return group
    const pages = [...group.pages]
    ;[pages[fromIndex], pages[toIndex]] = [pages[toIndex], pages[fromIndex]]
    return { ...group, pages }
  })
}

/* ------------------------------------------------------- Image preview */

/* Every page here is still just a local File/Blob -- nothing has been
   uploaded yet -- so previewing it needs no server round trip at all,
   just a local object URL. Cached per entry.key so re-rendering the
   list doesn't keep minting new URLs (and leaking memory) for the same
   file; revoked on unmount so closing/leaving Upload frees them. */
const previewUrlCache = new Map()
function previewUrl(entry) {
  if (!entry) return ''
  if (!previewUrlCache.has(entry.key)) previewUrlCache.set(entry.key, URL.createObjectURL(entry.file))
  return previewUrlCache.get(entry.key)
}
onUnmounted(() => {
  for (const url of previewUrlCache.values()) URL.revokeObjectURL(url)
  previewUrlCache.clear()
})

const previewEntry = ref(null)
function openPreview(entry) {
  previewEntry.value = entry
}
function closePreview() {
  previewEntry.value = null
}

/* ---------------------------------------------------------- Capture Live */

const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && window.isSecureContext
const cameraOpen = ref(false)
const cameraError = ref('')
const videoEl = ref(null)
let mediaStream = null
/* Pages captured so far for the student currently being photographed --
   committed into a real group only once "Finish Student" is clicked. */
const capturedPages = ref([])
const currentPageNo = computed(() => capturedPages.value.length + 1)
const targetPageCount = computed(() => Math.max(1, parseInt(pagesPerStudent.value) || 1))
const captureComplete = computed(() => capturedPages.value.length >= targetPageCount.value)
const lastCapturedPage = computed(() => capturedPages.value[capturedPages.value.length - 1] || null)

async function openCamera() {
  cameraError.value = ''
  capturedPages.value = []
  cameraOpen.value = true
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
    if (videoEl.value) videoEl.value.srcObject = mediaStream
  } catch (error) {
    cameraError.value = error?.message || 'Could not access the camera.'
  }
}

function stopStream() {
  mediaStream?.getTracks().forEach((track) => track.stop())
  mediaStream = null
}

function closeCamera() {
  stopStream()
  cameraOpen.value = false
  capturedPages.value = []
}
onUnmounted(stopStream)

function capturePage() {
  // Guards the data, not just the button: without this, a fast double-click
  // (or a click landing right as Vue re-renders the disabled state) could
  // still sneak an extra page in between the click and the button actually
  // disabling -- this is what a stray page count past "Pages per student"
  // was coming from.
  if (!videoEl.value || captureComplete.value) return
  const canvas = document.createElement('canvas')
  canvas.width = videoEl.value.videoWidth
  canvas.height = videoEl.value.videoHeight
  canvas.getContext('2d').drawImage(videoEl.value, 0, 0)
  canvas.toBlob((blob) => {
    if (!blob) return
    const file = new File([blob], `capture-${Date.now()}-p${currentPageNo.value}.jpg`, { type: 'image/jpeg' })
    capturedPages.value = [...capturedPages.value, normalizeEntry(file, 'Camera')]
  }, 'image/jpeg', 0.92)
}

function retakeLastPage() {
  capturedPages.value = capturedPages.value.slice(0, -1)
}

/* Commits the pages captured so far as one complete group and resets
   for the next student, keeping the camera open. */
function finishStudent() {
  if (!capturedPages.value.length) return
  groups.value = [
    ...groups.value,
    { key: nextGroupKey(), label: `Submission ${groups.value.length + 1} (captured)`, source: 'Camera', pages: capturedPages.value },
  ]
  capturedPages.value = []
}

/* "Done" means "I'm finished capturing" -- there's no reason for that to
   ever throw away pages you already captured, so any pages still pending
   for the current student are saved as their own submission first (same
   as clicking "Finish Student & Next" would do), then the camera closes.
   To discard a bad capture instead of saving it, use "Retake Last Page"
   down to zero pages first -- Done never prompts to destroy real data. */
function doneCapturing() {
  if (capturedPages.value.length) finishStudent()
  closeCamera()
}

async function proceed() {
  const keyId = store.selectedAnswerKeyId
  if (!keyId) {
    await showMessage('Answer Key Required', 'Select or create an answer key before processing.')
    return
  }
  const items = await API.answerKeyItems(keyId)
  if (!items.length) {
    await showMessage('Answer Key Is Empty', 'Add at least one valid item to the selected answer key.')
    return
  }
  if (!groups.value.length) {
    await showMessage('Images Required', 'Add at least one supported answer sheet image.')
    return
  }
  if (anyMismatched.value) {
    await showMessage(
      'Check Submissions',
      `One or more submissions don't have ${pagesPerStudent.value} page(s). Fix them in Review Submissions before continuing.`,
    )
    return
  }
  if (!consentConfirmed.value) {
    await showMessage(
      'Consent Confirmation Required',
      'Check the consent confirmation box below before proceeding -- it confirms paper consent was collected for every student in this queue.',
    )
    return
  }
  router.push({ name: 'processing' })
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Upload Answer Sheets</div>
      <div class="page-subtitle">Add individual images, a class folder, or capture pages live.</div>
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

        <div class="form-group">
          <label class="form-label" for="pages-per-student">Pages per Student</label>
          <input
            id="pages-per-student"
            v-model="pagesPerStudent"
            type="number"
            min="1"
            max="20"
            title="How many physical pages make up one student's submission. Only used to auto-group flat image uploads into submissions and to guide live capture -- folders always group by folder, and any submission can be fixed by hand below."
          >
        </div>

        <button
          v-if="!answerKeys.length"
          class="btn btn-secondary w-full mb-14"
          @click="router.push({ name: 'answer_key' })"
        >
          Create Answer Key
        </button>

        <div class="queue-summary" aria-label="Upload queue summary">
          <div><span>Submissions</span><strong>{{ groups.length }}</strong></div>
          <div><span>Pages</span><strong>{{ totalPages }}</strong></div>
          <div><span>Total size</span><strong>{{ formatBytes(totalBytes) }}</strong></div>
          <div><span>Folders</span><strong>{{ folderCount }}</strong></div>
        </div>

        <div class="model-note mt-14">
          <span class="badge badge-blue">Automated Grading</span>
          <p>
            Each submission is graded automatically when processing runs; low-confidence answers are flagged for review.
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
            <button type="button" class="btn btn-secondary" @click.stop="browseFolder">
              Browse Folder
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="!cameraSupported"
              :title="cameraSupported ? 'Photograph pages directly, one student at a time.' : 'Live capture needs a secure connection (HTTPS or localhost).'"
              @click.stop="openCamera"
            >
              Capture Live
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
            <div class="section-title">Review Submissions</div>
            <div class="muted-text">
              {{ groups.length ? `${groups.length} submission(s), ${totalPages} page(s) total.` : 'No submissions yet.' }}
              <span v-if="anyMismatched" class="badge badge-warning ml-8">Some submissions need attention</span>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-danger btn-small"
            :disabled="!groups.length"
            @click="clearQueue"
          >
            Clear Queue
          </button>
        </div>

        <div class="submission-groups">
          <div v-if="!groups.length" class="file-empty">
            Choose images, a folder, or capture live to build the processing queue.
          </div>

          <div
            v-for="(group, groupIndex) in groups"
            :key="group.key"
            class="submission-card"
            :class="{ 'submission-mismatch': isMismatched(group) }"
          >
            <div class="submission-card-head">
              <div>
                <strong>{{ displayGroupLabel(group, groupIndex) }}</strong>
                <span class="badge badge-gray ml-8">{{ group.source }}</span>
                <span v-if="isMismatched(group)" class="badge badge-warning ml-8">
                  {{ group.pages.length }} of {{ pagesPerStudent }} page(s)
                </span>
              </div>
              <button type="button" class="btn btn-secondary btn-small" @click="deleteGroup(groupIndex)">
                Remove Submission
              </button>
            </div>

            <div class="submission-pages">
              <div v-for="(entry, pageIndex) in group.pages" :key="entry.key" class="submission-page">
                <img
                  :src="previewUrl(entry)"
                  :alt="`Preview of ${entry.name}`"
                  class="submission-thumb"
                  title="Click to preview full size"
                  @click="openPreview(entry)"
                >
                <select
                  class="submission-move-select"
                  :value="pageIndex"
                  :disabled="group.pages.length < 2"
                  title="Change this page's position -- swaps it with whichever page is currently there"
                  @change="swapPages(groupIndex, pageIndex, parseInt($event.target.value))"
                >
                  <option v-for="(_, i) in group.pages" :key="i" :value="i">Page {{ i + 1 }}</option>
                </select>
                <span class="submission-page-name" :title="entry.relativePath">{{ entry.name }}</span>
                <span class="upload-file-size">{{ formatBytes(entry.size) }}</span>
                <select
                  class="submission-move-select"
                  :value="group.key"
                  title="Move this page to a different submission"
                  @change="movePage(groupIndex, pageIndex, $event.target.value)"
                >
                  <option :value="group.key" disabled>Move to...</option>
                  <option value="__new__">New submission</option>
                  <option
                    v-for="(other, otherIndex) in groups"
                    :key="other.key"
                    :value="other.key"
                    :disabled="other.key === group.key"
                  >
                    {{ displayGroupLabel(other, otherIndex) }}
                  </option>
                </select>
                <button
                  type="button"
                  class="btn btn-secondary btn-small"
                  :aria-label="`Remove ${entry.name}`"
                  @click="removePage(groupIndex, pageIndex)"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>

        <label class="checkbox-row">
          <input
            v-model="consentConfirmed"
            type="checkbox"
            title="Required: confirms consent was collected before any of these sheets were scanned."
          >
          I have obtained and kept signed consent (per
          <LegalDocumentLink document="privacy">Privacy Policy</LegalDocumentLink> /
          <LegalDocumentLink document="terms">Terms</LegalDocumentLink>) for every student in this queue.
        </label>

        <div class="workflow-actions">
          <button type="button" class="btn btn-primary" :disabled="!consentConfirmed" @click="proceed">
            Proceed to Processing
          </button>
        </div>
      </section>
    </div>

    <!-- Capture Live modal -->
    <div v-if="cameraOpen" class="toast-overlay" @click.self="doneCapturing">
      <div class="toast-box camera-box">
        <div class="toast-title">Capture Live</div>

        <div v-if="cameraError" class="muted-text mb-8">{{ cameraError }}</div>
        <template v-else>
          <div class="camera-preview">
            <video ref="videoEl" autoplay playsinline muted></video>
          </div>
          <div class="muted-text mt-8 mb-8">
            <template v-if="captureComplete">All {{ targetPageCount }} page(s) captured for this student.</template>
            <template v-else>Page {{ currentPageNo }} of {{ targetPageCount }} for this student.</template>
            {{ capturedPages.length ? `${capturedPages.length} page(s) captured so far.` : '' }}
          </div>

          <div class="flex gap-8 flex-wrap items-center">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="captureComplete"
              :title="captureComplete ? 'All pages for this student are already captured -- use Finish Student & Next.' : ''"
              @click="capturePage"
            >
              {{ captureComplete ? 'All Pages Captured' : `Capture Page ${currentPageNo}` }}
            </button>
            <button type="button" class="btn btn-secondary" :disabled="!capturedPages.length" @click="retakeLastPage">
              Retake Last Page
            </button>
            <img
              v-if="lastCapturedPage"
              :src="previewUrl(lastCapturedPage)"
              alt="Last captured page"
              class="submission-thumb"
              title="Last captured page -- click to preview full size"
              @click="openPreview(lastCapturedPage)"
            >
          </div>
        </template>

        <div class="toast-actions mt-14">
          <button class="btn btn-secondary" @click="doneCapturing">Done</button>
          <button class="btn btn-primary" :disabled="!capturedPages.length" @click="finishStudent">
            Finish Student &amp; Next
          </button>
        </div>
      </div>
    </div>

    <!-- Image preview -- local blob URL only, nothing has been uploaded yet -->
    <div v-if="previewEntry" class="toast-overlay" @click.self="closePreview">
      <div class="toast-box preview-box">
        <div class="toast-title">{{ previewEntry.name }}</div>
        <img :src="previewUrl(previewEntry)" :alt="`Full preview of ${previewEntry.name}`" class="preview-image">
        <div class="toast-actions mt-14">
          <button class="btn btn-secondary" @click="closePreview">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>
