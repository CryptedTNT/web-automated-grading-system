<script setup>
/* ============================================================
   AnswerKeyView.vue — Exam questionnaire builder + answer key
   Teachers type the actual question/choice text and mark the
   correct answer in one grouped-by-type workflow (Multiple
   Choice, True or False, Identification, Enumeration), then can
   preview/print a sheet styled after the paper exam template.
   ============================================================ */

import { ref, computed, onMounted } from 'vue'
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx'
import { API } from '@/services/api.js'
import { showMessage, showConfirm } from '@/services/dialog.js'

const Q_TYPES = ['Multiple Choice', 'True or False', 'Identification', 'Enumeration']
const MC_LETTERS = ['a', 'b', 'c', 'd']

const keys = ref([])
const currentKeyId = ref(null)
const creatingNew = ref(false)
const keyName = ref('')

const mcItems = ref([])
const tfItems = ref([])
const idItems = ref([])
const enumGroups = ref([])
/* Any saved row whose `type` isn't one of the 4 known values (e.g. hand-edited
   localStorage) is carried through unedited rather than silently dropped. */
const otherItems = ref([])

/* v-for needs a stable key per row/blank, and rows have no database id until
   saved — so each one carries a local uid, shared across every section. */
let nextUid = 1

function makeMcItem(item) {
  const v = item || {}
  const choices = v.choices || {}
  return {
    uid: nextUid++,
    question_text: v.question_text ?? '',
    choices: { a: choices.a ?? '', b: choices.b ?? '', c: choices.c ?? '', d: choices.d ?? '' },
    correct: v.correct_answer || 'a',
    points: v.points ?? 1,
    threshold: v.fuzzy_threshold ?? 100,
  }
}

function makeTfItem(item) {
  const v = item || {}
  return {
    uid: nextUid++,
    question_text: v.question_text ?? '',
    correct: v.correct_answer || 'True',
    points: v.points ?? 1,
    threshold: v.fuzzy_threshold ?? 100,
  }
}

function makeIdItem(item) {
  const v = item || {}
  return {
    uid: nextUid++,
    question_text: v.question_text ?? '',
    correct: v.correct_answer ?? '',
    alternatives: v.alternatives ?? '',
    points: v.points ?? 1,
    threshold: v.fuzzy_threshold ?? 85,
  }
}

function makeEnumBlank(item) {
  const v = item || {}
  return {
    uid: nextUid++,
    correct: v.correct_answer ?? '',
    points: v.points ?? 1,
    threshold: v.fuzzy_threshold ?? 85,
  }
}

function makeEnumGroup(questionText, blankItems) {
  const blanks = blankItems && blankItems.length ? blankItems : [null]
  return {
    uid: nextUid++,
    question_text: questionText ?? '',
    blanks: blanks.map(makeEnumBlank),
  }
}

/* Serialized copy of the last saved (or freshly loaded) state. Comparing
   against it is what tells us the builder has unsaved edits — without this
   the original replaced everything on a stray click in the sidebar and a
   teacher could lose a whole typed-up questionnaire with no warning. */
const savedSnapshot = ref('')

function stripUid(value) {
  if (Array.isArray(value)) return value.map(stripUid)
  if (value && typeof value === 'object') {
    const { uid, ...rest } = value
    for (const k of Object.keys(rest)) rest[k] = stripUid(rest[k])
    return rest
  }
  return value
}

function snapshot() {
  return JSON.stringify({
    name: keyName.value.trim(),
    mc: stripUid(mcItems.value),
    tf: stripUid(tfItems.value),
    id: stripUid(idItems.value),
    enumGroups: stripUid(enumGroups.value),
    other: otherItems.value,
  })
}

const isDirty = computed(() => snapshot() !== savedSnapshot.value)

async function confirmDiscard() {
  if (!isDirty.value) return true
  return showConfirm(
    'Discard Unsaved Changes',
    'This exam questionnaire has unsaved changes. Discard them and continue?',
  )
}

async function reload(selectKeyId) {
  keys.value = await API.answerKeys()
  const targetId = selectKeyId || currentKeyId.value || keys.value[0]?.id || null
  if (targetId && !creatingNew.value) await loadKey(targetId)
  // Nothing to load (no keys yet, or the last one was just deleted):
  // baseline the snapshot so an untouched empty form is not "dirty".
  else savedSnapshot.value = snapshot()
}

async function loadKey(keyId) {
  const key = keys.value.find((k) => k.id === keyId)
  if (!key) return
  creatingNew.value = false
  currentKeyId.value = keyId
  keyName.value = key.name

  const items = await API.answerKeyItems(keyId)
  mcItems.value = items.filter((i) => i.type === 'Multiple Choice').map(makeMcItem)
  tfItems.value = items.filter((i) => i.type === 'True or False').map(makeTfItem)
  idItems.value = items.filter((i) => i.type === 'Identification').map(makeIdItem)

  const enumRows = items.filter((i) => i.type === 'Enumeration')
  const groups = new Map()
  enumRows.forEach((row) => {
    // Legacy rows saved before grouping was auto-assigned may lack enum_group.
    const groupKey = row.enum_group != null ? row.enum_group : `solo-${row.id}`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(row)
  })
  enumGroups.value = [...groups.values()].map((rows) => makeEnumGroup(rows[0]?.question_text, rows))

  otherItems.value = items.filter((i) => !Q_TYPES.includes(i.type))

  savedSnapshot.value = snapshot()
}

/* Sidebar clicks go through here so unsaved work is never silently lost. */
async function selectKey(keyId) {
  if (keyId === currentKeyId.value && !creatingNew.value) return
  if (!(await confirmDiscard())) return
  await loadKey(keyId)
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
  keyName.value = nextKeyName()
  mcItems.value = []
  tfItems.value = []
  idItems.value = []
  enumGroups.value = []
  otherItems.value = []
  savedSnapshot.value = snapshot()
}

function addMcItem() { mcItems.value.push(makeMcItem()) }
function removeMcItem(uid) { mcItems.value = mcItems.value.filter((r) => r.uid !== uid) }

function addTfItem() { tfItems.value.push(makeTfItem()) }
function removeTfItem(uid) { tfItems.value = tfItems.value.filter((r) => r.uid !== uid) }

function addIdItem() { idItems.value.push(makeIdItem()) }
function removeIdItem(uid) { idItems.value = idItems.value.filter((r) => r.uid !== uid) }

function addEnumGroup() { enumGroups.value.push(makeEnumGroup()) }
function removeEnumGroup(uid) { enumGroups.value = enumGroups.value.filter((g) => g.uid !== uid) }
function addEnumBlank(group) { group.blanks.push(makeEnumBlank()) }
function removeEnumBlank(group, uid) {
  if (group.blanks.length <= 1) return
  group.blanks = group.blanks.filter((b) => b.uid !== uid)
}

/* Flattens the 4 grouped sections into one ordered array (MC, then True/False,
   then Identification, then Enumeration) with freshly computed sequential
   item_no. A row/group is kept if it has any typed content; nothing throws,
   so saving an untouched legacy key behaves exactly as it did before. */
function collectItems() {
  const items = []

  mcItems.value.forEach((row) => {
    const q = row.question_text.trim()
    const choices = {
      a: row.choices.a.trim(),
      b: row.choices.b.trim(),
      c: row.choices.c.trim(),
      d: row.choices.d.trim(),
    }
    if (!q && !Object.values(choices).some((c) => c)) return
    items.push({
      item_no: items.length + 1,
      type: 'Multiple Choice',
      enum_group: null,
      question_text: q,
      choices,
      correct_answer: row.correct,
      alternatives: '',
      points: parseFloat(row.points) || 1,
      fuzzy_threshold: parseInt(row.threshold) || 85,
    })
  })

  tfItems.value.forEach((row) => {
    const q = row.question_text.trim()
    if (!q) return
    items.push({
      item_no: items.length + 1,
      type: 'True or False',
      enum_group: null,
      question_text: q,
      choices: null,
      correct_answer: row.correct,
      alternatives: '',
      points: parseFloat(row.points) || 1,
      fuzzy_threshold: parseInt(row.threshold) || 85,
    })
  })

  idItems.value.forEach((row) => {
    const q = row.question_text.trim()
    const correct = String(row.correct).trim()
    if (!q && !correct) return
    items.push({
      item_no: items.length + 1,
      type: 'Identification',
      enum_group: null,
      question_text: q,
      choices: null,
      correct_answer: correct,
      alternatives: String(row.alternatives).trim(),
      points: parseFloat(row.points) || 1,
      fuzzy_threshold: parseInt(row.threshold) || 85,
    })
  })

  let groupNo = 0
  enumGroups.value.forEach((group) => {
    const q = group.question_text.trim()
    const blanks = group.blanks.filter((b) => String(b.correct).trim())
    if (!q && !blanks.length) return
    groupNo += 1
    blanks.forEach((b) => {
      items.push({
        item_no: items.length + 1,
        type: 'Enumeration',
        enum_group: groupNo,
        question_text: q,
        choices: null,
        correct_answer: String(b.correct).trim(),
        alternatives: '',
        points: parseFloat(b.points) || 1,
        fuzzy_threshold: parseInt(b.threshold) || 85,
      })
    })
  })

  items.push(...otherItems.value)
  return items
}

async function saveKey() {
  const name = keyName.value.trim() || 'Untitled Answer Key'
  const items = collectItems()
  if (!items.length) {
    showMessage('No Items', 'Add at least one question before saving.')
    return
  }

  let keyId
  try {
    if (currentKeyId.value === null || creatingNew.value) {
      keyId = await API.createAnswerKey(name, '')
    } else {
      keyId = currentKeyId.value
      await API.updateAnswerKey(keyId, name, '')
    }
    await API.replaceAnswerKeyItems(keyId, items)
  } catch (e) {
    // Without this, a network/backend failure here failed silently --
    // the button click did nothing visible at all, which is
    // indistinguishable from the app being broken.
    await showMessage('Save Failed', e.message || 'The exam questionnaire could not be saved. Check that the server is running and try again.')
    return
  }

  creatingNew.value = false
  currentKeyId.value = keyId
  await showMessage('Saved', 'Exam questionnaire saved.')
  await reload(keyId) // reloads from storage and refreshes the dirty snapshot
}

async function deleteAnswerKey() {
  if (currentKeyId.value === null) {
    showMessage('No Questionnaire Selected', 'Select an exam questionnaire to delete.')
    return
  }
  const yes = await showConfirm('Delete Questionnaire', 'Delete this exam questionnaire? This cannot be undone.')
  if (!yes) return

  try {
    await API.deleteAnswerKey(currentKeyId.value)
  } catch (e) {
    await showMessage('Delete Failed', e.message || 'The exam questionnaire could not be deleted. Check that the server is running and try again.')
    return
  }
  currentKeyId.value = null
  keyName.value = ''
  mcItems.value = []
  tfItems.value = []
  idItems.value = []
  enumGroups.value = []
  otherItems.value = []
  savedSnapshot.value = snapshot() // the emptied form is not "unsaved work"
  await reload()
}

const hasKeys = computed(() => keys.value.length > 0)

/* --------------------------------------------------------
   Preview / Print — a standalone printable document styled
   after the paper exam template, built from live draft data
   (not just what's saved), same pattern as the generic
   template in SettingsView.vue but with real question content.
   -------------------------------------------------------- */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

/* Shared by Preview/Print and Download as Word: collects the current
   draft's items (even if unsaved) and confirms proceeding if some are
   incomplete. Returns null if there's nothing to export or the
   teacher backs out, so both callers can bail the same way. */
async function getExportableItems(actionLabel) {
  const items = collectItems()
  if (!items.length) {
    await showMessage('No Items', `Add at least one question before ${actionLabel}.`)
    return null
  }
  const missing = items.filter((i) =>
    !i.question_text.trim() ||
    (i.type === 'Multiple Choice' && Object.values(i.choices).some((c) => !c.trim())),
  )
  if (missing.length) {
    const proceed = await showConfirm(
      'Incomplete Questionnaire',
      `${missing.length} question(s) are missing question text or choices and will be left blank. Continue anyway?`,
    )
    if (!proceed) return null
  }
  return items
}

async function previewQuestionnaire() {
  // window.open() must happen synchronously, before any await — otherwise
  // the browser no longer ties it to this click and silently blocks it.
  const preview = window.open('', '_blank')
  if (!preview) {
    showMessage('Preview Blocked', 'Allow pop-ups for this page to preview the questionnaire.')
    return
  }

  const items = await getExportableItems('previewing')
  if (!items) {
    preview.close()
    return
  }

  preview.document.open()
  preview.document.write(questionnaireHtml(items))
  preview.document.close()
}

async function downloadQuestionnaireWord() {
  const items = await getExportableItems('downloading')
  if (!items) return

  const doc = buildQuestionnaireDocx(items)
  const blob = await Packer.toBlob(doc)
  const filename = `${(keyName.value.trim() || 'Untitled Answer Key').replace(/[<>:"/\\|?*]+/g, '_')}.docx`

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/* Instruction line printed under each section heading. The underline
   blank before every question number is kept regardless (see .blank
   below): that's what the YOLO detector is trained to find on a
   printed/scanned sheet, so it can't be dropped for a cosmetic pass. */
const SECTION_META = {
  'Multiple Choice': {
    instruction: 'Write the correct answer in the space provided.',
  },
  'True or False': {
    instruction: 'Write <strong>TRUE</strong> if the statement is correct, and <strong>FALSE</strong> if the statement is wrong.',
  },
  Identification: {
    instruction: 'Write the correct answer in the space provided.',
  },
  Enumeration: {
    instruction: 'Enumerate the answers needed for each number.',
  },
}

function questionnaireHtml(items) {
  const title = escapeHtml(keyName.value.trim() || 'Untitled Answer Key')

  const sections = [
    { label: 'I', name: 'Multiple Choice', items: items.filter((i) => i.type === 'Multiple Choice') },
    { label: 'II', name: 'True or False', items: items.filter((i) => i.type === 'True or False') },
    { label: 'III', name: 'Identification', items: items.filter((i) => i.type === 'Identification') },
    { label: 'IV', name: 'Enumeration', items: items.filter((i) => i.type === 'Enumeration') },
  ].filter((section) => section.items.length)

  let sectionsHtml = ''
  sections.forEach((section) => {
    const meta = SECTION_META[section.name]
    sectionsHtml += `<div class="section">
      <div class="section-title">${section.label}. ${escapeHtml(section.name)}</div>
      <div class="section-instruction">${meta.instruction}</div>`

    if (section.name === 'Enumeration') {
      // Numbering restarts per section for display only, independent of the
      // items' internal global item_no used for grading position-matching.
      const groups = new Map()
      section.items.forEach((item) => {
        if (!groups.has(item.enum_group)) groups.set(item.enum_group, [])
        groups.get(item.enum_group).push(item)
      })
      let groupNo = 0
      for (const groupItems of groups.values()) {
        groupNo += 1
        // Wrapped in one block so a page break never lands between the
        // prompt and its blanks, or between two of that group's blanks.
        sectionsHtml += `<div class="block"><div class="q-prompt">${groupNo}. ${escapeHtml(groupItems[0].question_text)}</div><div class="enum-blanks">`
        groupItems.forEach(() => {
          sectionsHtml += `<div class="blank-line">- <span class="blank"></span></div>`
        })
        sectionsHtml += `</div></div>`
      }
    } else {
      section.items.forEach((item, idx) => {
        // Wrapped in one block so a page break never separates a question
        // from its own choices.
        sectionsHtml += `<div class="block"><div class="q-line"><span class="blank"></span>${idx + 1}. ${escapeHtml(item.question_text)}</div>`
        if (section.name === 'Multiple Choice') {
          sectionsHtml += `<div class="choices">`
            + `<span>a. ${escapeHtml(item.choices.a)}</span>`
            + `<span>b. ${escapeHtml(item.choices.b)}</span>`
            + `<span>c. ${escapeHtml(item.choices.c)}</span>`
            + `<span>d. ${escapeHtml(item.choices.d)}</span>`
            + `</div>`
        }
        sectionsHtml += `</div>`
      })
    }

    sectionsHtml += `</div>`
  })

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      max-width: 820px; margin: 28px auto; padding: 0 24px;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
      color: #1f2937; line-height: 1.5;
    }
    .fields {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px 28px;
      margin: 12px 0 24px;
    }
    .field-row { display: flex; align-items: flex-end; gap: 8px; white-space: nowrap; font-size: 13px; color: #4b5563; }
    .line { flex: 1; min-height: 1px; margin-bottom: 2px; border-bottom: 1px solid #111827; }
    .section { margin-top: 22px; }
    .section-title {
      font-weight: 700; font-size: 14px; margin-bottom: 3px; color: #000;
      break-after: avoid; page-break-after: avoid;
    }
    .section-instruction {
      font-size: 12.5px; color: #374151; margin-bottom: 10px;
      break-after: avoid; page-break-after: avoid;
    }
    /* Keeps a question and its own choices/blanks together -- without
       this a page break can land between a question and its answer
       lines, splitting one item across two sheets. */
    .block { break-inside: avoid; page-break-inside: avoid; }
    .q-line, .q-prompt { margin: 10px 0 4px; }
    .blank { display: inline-block; min-width: 60px; border-bottom: 1px solid #111827; margin-right: 6px; }
    .choices { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; margin: 2px 0 10px 66px; color: #4b5563; font-size: 13px; }
    .enum-blanks { margin-left: 20px; }
    .blank-line { margin: 6px 0; }
    .print { margin: 0 0 18px; padding: 9px 16px; border: 0; border-radius: 6px; background: #1f6fb2; color: white; cursor: pointer; font-weight: 600; }
    .print:hover { background: #185c96; }
    /* The actual paper margin used when printing/saving as PDF -- distinct
       from the body's padding above, which only affects the on-screen
       preview's content box. Auto-pagination for overflowing content is
       the browser's native print behavior; this just makes it 1" on
       every sheet instead of whatever the browser/printer defaults to. */
    @page { margin: 1in; }
    @media print {
      body { margin: 0; max-width: none; padding: 0; }
      .print { display: none; }
    }
  </style>
</head>
<body>
  <button class="print" onclick="window.print()">Print Questionnaire</button>
  <div class="fields">
    <div class="field-row">Name:<div class="line"></div></div>
    <div class="field-row">Date:<div class="line"></div></div>
    <div class="field-row">Section:<div class="line"></div></div>
    <div class="field-row">Score:<div class="line"></div></div>
  </div>
  ${sectionsHtml}
</body>
</html>`
}

/* Splits "Write <strong>TRUE</strong> ... <strong>FALSE</strong> ..." into
   plain and bold runs without pulling in an HTML parser -- the only markup
   SECTION_META instructions ever contain is <strong>. */
function instructionRuns(html) {
  return html
    .split(/(<strong>.*?<\/strong>)/g)
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^<strong>(.*)<\/strong>$/)
      return new TextRun({ text: match ? match[1] : part, bold: Boolean(match), size: 20, color: '444444' })
    })
}

/* Word counterpart to questionnaireHtml() — same content and section
   order, built with the `docx` library instead of an HTML string, for
   teachers who want an editable/portable file rather than a print-only
   page. Blanks are a run of underscores (docx has no CSS border-bottom
   equivalent); margins are the standard 1" on every side. */
/* 1.5 line spacing on every paragraph, matching questionnaireHtml()'s
   `body { line-height: 1.5 }` -- without this, Word's default single
   spacing makes the same before/after margins look far more cramped
   than the browser preview even with identical twip values. */
const LINE_SPACING = { line: 360, lineRule: 'auto' }

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
}

function buildQuestionnaireDocx(items) {
  const blank = (length) => '_'.repeat(length)

  const sections = [
    { label: 'I', name: 'Multiple Choice', items: items.filter((i) => i.type === 'Multiple Choice') },
    { label: 'II', name: 'True or False', items: items.filter((i) => i.type === 'True or False') },
    { label: 'III', name: 'Identification', items: items.filter((i) => i.type === 'Identification') },
    { label: 'IV', name: 'Enumeration', items: items.filter((i) => i.type === 'Enumeration') },
  ].filter((section) => section.items.length)

  const children = [
    new Paragraph({
      spacing: { ...LINE_SPACING, after: 160 },
      children: [
        new TextRun({ text: 'Name: ' }),
        new TextRun({ text: blank(28) }),
        new TextRun({ text: '    Date: ' }),
        new TextRun({ text: blank(18) }),
      ],
    }),
    new Paragraph({
      spacing: { ...LINE_SPACING, after: 360 },
      children: [
        new TextRun({ text: 'Section: ' }),
        new TextRun({ text: blank(25) }),
        new TextRun({ text: '    Score: ' }),
        new TextRun({ text: blank(18) }),
      ],
    }),
  ]

  // Even 4-column spread for MC choices, matching questionnaireHtml()'s
  // `.choices { grid-template-columns: repeat(4, 1fr) }` -- padded text
  // alone can't do this reliably in a proportional font like Word's
  // default, so each choice gets its own equal-width, borderless cell.
  function choicesRow(choices) {
    const cell = (text) =>
      new TableCell({
        width: { size: 25, type: WidthType.PERCENTAGE },
        borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
        children: [
          new Paragraph({
            spacing: LINE_SPACING,
            children: [new TextRun({ text, size: 20, color: '444444' })],
          }),
        ],
      })
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      indent: { size: convertInchesToTwip(0.7), type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            cell(`a. ${choices.a}`),
            cell(`b. ${choices.b}`),
            cell(`c. ${choices.c}`),
            cell(`d. ${choices.d}`),
          ],
        }),
      ],
    })
  }

  sections.forEach((section) => {
    const meta = SECTION_META[section.name]
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { ...LINE_SPACING, before: 320, after: 80 },
        children: [new TextRun({ text: `${section.label}. ${section.name}`, bold: true, size: 26 })],
      }),
      // keepNext glues this to the first question that follows, so the
      // heading+instruction pair is never left alone at a page bottom.
      new Paragraph({
        keepNext: true,
        spacing: { ...LINE_SPACING, after: 240 },
        children: instructionRuns(meta.instruction),
      }),
    )

    if (section.name === 'Enumeration') {
      // Numbering restarts per section for display only, same as the print version.
      const groups = new Map()
      section.items.forEach((item) => {
        if (!groups.has(item.enum_group)) groups.set(item.enum_group, [])
        groups.get(item.enum_group).push(item)
      })
      let groupNo = 0
      for (const groupItems of groups.values()) {
        groupNo += 1
        children.push(
          new Paragraph({
            keepNext: true,
            spacing: { ...LINE_SPACING, before: 200, after: 80 },
            children: [new TextRun({ text: `${groupNo}. ${groupItems[0].question_text}` })],
          }),
        )
        groupItems.forEach((blankItem, blankIdx) => {
          children.push(
            new Paragraph({
              // Glue every blank but the last to the one after it, so the
              // whole group of answer lines resists being split apart --
              // the last blank stays free to break normally.
              keepNext: blankIdx < groupItems.length - 1,
              keepLines: true,
              indent: { left: convertInchesToTwip(0.3) },
              spacing: { ...LINE_SPACING, after: 160 },
              children: [new TextRun({ text: `-  ${blank(20)}` })],
            }),
          )
        })
      }
    } else {
      section.items.forEach((item, idx) => {
        children.push(
          new Paragraph({
            // keepNext glues this question to its own choices table (for MC)
            // so a page break can't separate a question from its answers.
            keepNext: section.name === 'Multiple Choice',
            keepLines: true,
            spacing: { ...LINE_SPACING, before: 200, after: 40 },
            children: [
              new TextRun({ text: `${blank(14)}  ` }),
              new TextRun({ text: `${idx + 1}. ${item.question_text}` }),
            ],
          }),
        )
        if (section.name === 'Multiple Choice') {
          children.push(choicesRow(item.choices))
          // A table can't carry its own bottom spacing the way a
          // paragraph does, so an empty spacer paragraph follows it.
          children.push(new Paragraph({ spacing: { after: 160 }, children: [] }))
        }
      })
    }
  })

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  })
}

onMounted(reload)
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Exam Questionnaires</div>
      <div class="page-subtitle">Type questions and mark answers, grouped the way exams are actually built.</div>
    </div>

    <div class="workflow-layout">
      <div class="card workflow-sidebar">
        <div class="card-title">Saved Questionnaires</div>
        <button
          class="btn btn-primary w-full mb-8"
          title="Create a new exam questionnaire."
          @click="newKey"
        >
          + Add New Exam Questionnaire
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
          <div v-if="!hasKeys" class="list-item muted-text">No exam questionnaires yet.</div>
        </div>

        <button
          class="btn btn-danger w-full mt-8"
          title="Delete the selected exam questionnaire."
          @click="deleteAnswerKey"
        >
          Delete Questionnaire
        </button>
      </div>

      <div class="card workflow-main">
        <div class="card-title">Questionnaire Details</div>

        <div class="form-group">
          <label class="form-label">Questionnaire Name</label>
          <input
            v-model="keyName"
            type="text"
            title="Enter a descriptive name for this exam questionnaire."
          >
        </div>

        <!-- I. Multiple Choice -->
        <div class="qb-section">
          <div class="card-title">I. Multiple Choice</div>
          <div v-for="(item, idx) in mcItems" :key="item.uid" class="mc-card">
            <div class="mc-card-header">
              <span class="qb-index">{{ idx + 1 }}.</span>
              <input
                v-model="item.question_text"
                type="text"
                placeholder="Question text"
                title="Question text"
              >
              <button
                class="btn btn-danger btn-small"
                title="Remove this question."
                @click="removeMcItem(item.uid)"
              >
                ✕
              </button>
            </div>
            <div class="mc-choices">
              <label v-for="letter in MC_LETTERS" :key="letter" class="mc-choice">
                <input
                  v-model="item.correct"
                  type="radio"
                  :name="'mc-correct-' + item.uid"
                  :value="letter"
                  title="Mark as the correct choice"
                >
                <span class="mc-choice-letter">{{ letter }}.</span>
                <input
                  v-model="item.choices[letter]"
                  type="text"
                  :placeholder="'Choice ' + letter.toUpperCase()"
                  title="Choice text"
                >
              </label>
            </div>
            <div class="mc-meta">
              <label>Points <input v-model.number="item.points" type="number" style="width:60px;" title="Points"></label>
              <label>Threshold % <input v-model.number="item.threshold" type="number" style="width:70px;" title="Fuzzy match threshold %"></label>
            </div>
          </div>
          <div v-if="!mcItems.length" class="muted-text mb-8">No multiple choice questions yet.</div>
          <button class="btn btn-secondary" title="Add a multiple choice question." @click="addMcItem">
            + Add Multiple Choice Question
          </button>
        </div>

        <!-- II. True or False -->
        <div class="qb-section">
          <div class="card-title">II. True or False</div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>#</th><th>Statement</th><th>Correct</th><th>Points</th><th>Threshold</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="(item, idx) in tfItems" :key="item.uid">
                  <td style="text-align:center;font-weight:700;">{{ idx + 1 }}</td>
                  <td><input v-model="item.question_text" type="text" title="Statement text"></td>
                  <td>
                    <select v-model="item.correct" title="Correct answer">
                      <option value="True">True</option>
                      <option value="False">False</option>
                    </select>
                  </td>
                  <td><input v-model.number="item.points" type="number" style="text-align:center;width:60px;" title="Points"></td>
                  <td><input v-model.number="item.threshold" type="number" style="text-align:center;width:70px;" title="Fuzzy match threshold %"></td>
                  <td>
                    <button class="btn btn-danger btn-small" title="Remove this statement." @click="removeTfItem(item.uid)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!tfItems.length" class="muted-text mb-8 mt-8">No true or false statements yet.</div>
          <button class="btn btn-secondary mt-8" title="Add a true or false statement." @click="addTfItem">
            + Add True or False Question
          </button>
        </div>

        <!-- III. Identification -->
        <div class="qb-section">
          <div class="card-title">III. Identification</div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>#</th><th>Question</th><th>Correct Answer</th><th>Alternative Answers</th><th>Points</th><th>Threshold</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="(item, idx) in idItems" :key="item.uid">
                  <td style="text-align:center;font-weight:700;">{{ idx + 1 }}</td>
                  <td><input v-model="item.question_text" type="text" title="Question text"></td>
                  <td><input v-model="item.correct" type="text" title="Correct answer"></td>
                  <td><input v-model="item.alternatives" type="text" title="Alternative answers"></td>
                  <td><input v-model.number="item.points" type="number" style="text-align:center;width:60px;" title="Points"></td>
                  <td><input v-model.number="item.threshold" type="number" style="text-align:center;width:70px;" title="Fuzzy match threshold %"></td>
                  <td>
                    <button class="btn btn-danger btn-small" title="Remove this question." @click="removeIdItem(item.uid)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!idItems.length" class="muted-text mb-8 mt-8">No identification questions yet.</div>
          <button class="btn btn-secondary mt-8" title="Add an identification question." @click="addIdItem">
            + Add Identification Question
          </button>
        </div>

        <!-- IV. Enumeration -->
        <div class="qb-section">
          <div class="card-title">IV. Enumeration</div>
          <div v-for="(group, idx) in enumGroups" :key="group.uid" class="enum-group">
            <div class="enum-group-header">
              <span class="qb-index">{{ idx + 1 }}.</span>
              <input
                v-model="group.question_text"
                type="text"
                placeholder="Enumeration prompt (e.g. Enumerate 4 examples of...)"
                title="Enumeration prompt"
              >
              <button
                class="btn btn-danger btn-small"
                title="Remove this enumeration question."
                @click="removeEnumGroup(group.uid)"
              >
                ✕
              </button>
            </div>
            <div v-for="blank in group.blanks" :key="blank.uid" class="enum-blank-row">
              <input v-model="blank.correct" type="text" placeholder="Accepted answer" title="Accepted answer">
              <label>Points <input v-model.number="blank.points" type="number" style="width:60px;" title="Points"></label>
              <label>Threshold % <input v-model.number="blank.threshold" type="number" style="width:70px;" title="Fuzzy match threshold %"></label>
              <button
                class="btn btn-danger btn-small"
                title="Remove this answer."
                :disabled="group.blanks.length <= 1"
                @click="removeEnumBlank(group, blank.uid)"
              >
                ✕
              </button>
            </div>
            <button class="btn btn-secondary btn-small" title="Add another accepted answer." @click="addEnumBlank(group)">
              + Add Answer
            </button>
          </div>
          <div v-if="!enumGroups.length" class="muted-text mb-8">No enumeration questions yet.</div>
          <button class="btn btn-secondary" title="Add an enumeration question." @click="addEnumGroup">
            + Add Enumeration Question
          </button>
        </div>

        <div class="flex gap-8 mt-8 items-center">
          <button class="btn btn-secondary" title="Preview and print this questionnaire." @click="previewQuestionnaire">
            Preview / Print Questionnaire
          </button>
          <button class="btn btn-secondary" title="Download this questionnaire as a Word document." @click="downloadQuestionnaireWord">
            Download as Word
          </button>
          <div class="spacer"></div>
          <button class="btn btn-primary" title="Save the exam questionnaire." @click="saveKey">Save Questionnaire</button>
        </div>
      </div>
    </div>
  </div>
</template>
