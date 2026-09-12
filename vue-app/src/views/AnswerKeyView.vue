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
import {
  escapeHtml,
  labeledSections,
  SECTION_META,
  questionnaireHtml,
  paginatePreview,
} from '@/services/questionnaireTemplate.js'

const Q_TYPES = ['Multiple Choice', 'True or False', 'Identification', 'Enumeration']
const MC_LETTERS = ['a', 'b', 'c', 'd']

const keys = ref([])
const currentKeyId = ref(null)
const creatingNew = ref(false)
const keyName = ref('')

/* Test sections, in the order the teacher built them -- each one picks
   its own question type from a dropdown (see qbSectionHeader in the
   template), and a type can only be used by one section at a time (see
   usedTypes/availableTypesFor below). This is what fixes numbering: I,
   II, III... reflect actual section order, never a fixed
   type-to-Roman-numeral mapping. */
const ROMAN = ['I', 'II', 'III', 'IV']
const qbSections = ref([])
/* Any saved row whose `type` isn't one of the 4 known values (e.g. hand-edited
   localStorage) is carried through unedited rather than silently dropped. */
const otherItems = ref([])

/* v-for needs a stable key per row/blank, and rows have no database id until
   saved — so each one carries a local uid, shared across every section. */
let nextUid = 1

/* Multiple Choice's "correct" answer is a set of one or more letters --
   plain "a" for a normal item, "a,b,c" for a "select all that apply"
   one (backend/app/inference/grading.py's grade_multiple_choice grades
   these as an exact-set match, all-or-nothing). Stored as a
   comma-separated string; edited here as an array so the template can
   bind it straight to a group of checkboxes. */
function parseCorrectLetters(raw) {
  const letters = String(raw || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter((s) => MC_LETTERS.includes(s))
  return letters.length ? letters : ['a']
}

function makeMcItem(item) {
  const v = item || {}
  const choices = v.choices || {}
  return {
    uid: nextUid++,
    question_text: v.question_text ?? '',
    choices: { a: choices.a ?? '', b: choices.b ?? '', c: choices.c ?? '', d: choices.d ?? '' },
    correct: parseCorrectLetters(v.correct_answer),
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

/* One fresh row for a brand-new section of this type, or after a
   section's type is switched (see onSectionTypeChange). */
function defaultItemsForType(type) {
  if (type === 'Multiple Choice') return [makeMcItem()]
  if (type === 'True or False') return [makeTfItem()]
  if (type === 'Identification') return [makeIdItem()]
  if (type === 'Enumeration') return [makeEnumGroup()]
  return []
}

/* Rebuilds one section's items from saved rows, dispatching by type --
   used when loading a key (see loadKey). */
function buildSectionItems(type, rows) {
  if (type === 'Multiple Choice') return rows.map(makeMcItem)
  if (type === 'True or False') return rows.map(makeTfItem)
  if (type === 'Identification') return rows.map(makeIdItem)
  if (type === 'Enumeration') {
    const groups = new Map()
    rows.forEach((row) => {
      // Legacy rows saved before grouping was auto-assigned may lack enum_group.
      const groupKey = row.enum_group != null ? row.enum_group : `solo-${row.id}`
      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey).push(row)
    })
    return [...groups.values()].map((groupRows) => makeEnumGroup(groupRows[0]?.question_text, groupRows))
  }
  return []
}

function itemHasContent(type, item) {
  if (type === 'Multiple Choice') return Boolean(item.question_text.trim() || Object.values(item.choices).some((c) => c.trim()))
  if (type === 'True or False') return Boolean(item.question_text.trim())
  if (type === 'Identification') return Boolean(item.question_text.trim() || String(item.correct).trim())
  if (type === 'Enumeration') return Boolean(item.question_text.trim() || item.blanks.some((b) => String(b.correct).trim()))
  return false
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
    sections: qbSections.value.map((section) => ({ type: section.type, items: stripUid(section.items) })),
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
  otherItems.value = items.filter((i) => !Q_TYPES.includes(i.type))

  // Items arrive ordered by item_no (see backend/app/routers/answer_keys.py),
  // and collectItems() always writes one type's items as one contiguous
  // block -- so the order distinct types first appear in IS the section
  // order the teacher originally built, with no extra bookkeeping needed.
  const rowsByType = new Map()
  const typeOrder = []
  items.forEach((row) => {
    if (!Q_TYPES.includes(row.type)) return
    if (!rowsByType.has(row.type)) {
      rowsByType.set(row.type, [])
      typeOrder.push(row.type)
    }
    rowsByType.get(row.type).push(row)
  })

  qbSections.value = typeOrder.map((type) => ({
    uid: nextUid++,
    type,
    items: buildSectionItems(type, rowsByType.get(type)),
  }))

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
  qbSections.value = [{ uid: nextUid++, type: 'Multiple Choice', items: defaultItemsForType('Multiple Choice') }]
  otherItems.value = []
  savedSnapshot.value = snapshot()
}

/* ---------------------------------------------------- Test sections */

const usedTypes = computed(() => new Set(qbSections.value.map((s) => s.type)))
const canAddSection = computed(() => usedTypes.value.size < Q_TYPES.length)

/* A section's own current type stays selectable in its own dropdown;
   every other section's type is excluded so the same type can't be
   picked twice, per the panel's requirement. Removing a section (or
   switching its type away) frees its type back up for the others. */
function availableTypesFor(section) {
  return Q_TYPES.filter((t) => t === section.type || !usedTypes.value.has(t))
}

function addSection() {
  const nextType = Q_TYPES.find((t) => !usedTypes.value.has(t))
  if (!nextType) return
  qbSections.value = [...qbSections.value, { uid: nextUid++, type: nextType, items: defaultItemsForType(nextType) }]
}

async function removeSection(uid) {
  const ok = await showConfirm('Remove Test Section?', 'Remove this test section and all of its questions?')
  if (!ok) return
  qbSections.value = qbSections.value.filter((s) => s.uid !== uid)
}

/* Switching a section's type discards its current rows -- the fields
   aren't compatible across types (choices vs. True/False vs.
   alternatives vs. blanks) -- so this confirms first if anything was
   actually typed in. */
async function onSectionTypeChange(section, newType) {
  if (newType === section.type) return
  const hasContent = section.items.some((item) => itemHasContent(section.type, item))
  if (hasContent) {
    const ok = await showConfirm(
      'Change Question Type?',
      'Changing the question type will clear this section\'s current questions. Continue?',
    )
    if (!ok) return // the <select> is bound to section.type, so it snaps back on its own
  }
  section.type = newType
  section.items = defaultItemsForType(newType)
}

function addItemToSection(section) {
  section.items = [...section.items, ...defaultItemsForType(section.type)]
}
function removeItemFromSection(section, uid) {
  section.items = section.items.filter((item) => item.uid !== uid)
}

function addEnumBlank(group) { group.blanks.push(makeEnumBlank()) }
function removeEnumBlank(group, uid) {
  if (group.blanks.length <= 1) return
  group.blanks = group.blanks.filter((b) => b.uid !== uid)
}

/* Flattens qbSections, in the teacher's own section order, into one
   array with freshly computed sequential item_no. A row/group is kept
   if it has any typed content; nothing throws, so saving an untouched
   legacy key behaves exactly as it did before. */
function collectItems() {
  const items = []

  qbSections.value.forEach((section) => {
    if (section.type === 'Multiple Choice') {
      section.items.forEach((row) => {
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
          correct_answer: [...row.correct].sort().join(','),
          alternatives: '',
          points: parseFloat(row.points) || 1,
          fuzzy_threshold: parseInt(row.threshold) || 85,
        })
      })
    } else if (section.type === 'True or False') {
      section.items.forEach((row) => {
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
    } else if (section.type === 'Identification') {
      section.items.forEach((row) => {
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
    } else if (section.type === 'Enumeration') {
      let groupNo = 0
      section.items.forEach((group) => {
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
    }
  })

  // Renumbered here too, same as every branch above -- otherItems still
  // carries whatever item_no it had when loaded from the server, and
  // leaving that as-is let it collide with the freshly-assigned 1..N
  // numbers above (answer_key_item has a UNIQUE (answer_key_id, item_no)
  // constraint, so a collision failed the whole save with a raw 500
  // instead of a clean error, since nothing here or in the backend
  // catches that specific database error).
  otherItems.value.forEach((item) => {
    items.push({ ...item, item_no: items.length + 1 })
  })
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
  qbSections.value = []
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
    (i.type === 'Multiple Choice' && Object.values(i.choices).some((c) => !c.trim())) ||
    (i.type === 'Multiple Choice' && !i.correct_answer),
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
  preview.document.write(questionnaireHtml(keyName.value.trim() || 'Untitled Answer Key', items))
  preview.document.close()

  // #flow (written above) is the real, unbroken document -- exactly what
  // @media print's page-break rules lay out correctly when actually
  // printing/saving as PDF, left completely untouched. This splits that
  // same content into #pages, a separate on-screen-only copy sliced into
  // fixed-size boxes that look like actual sheets, since CSS page-break
  // rules only take visual effect during real print layout, never in a
  // plain scrolling window -- there's no on-screen "paged" mode in
  // standard CSS to lean on instead.
  paginatePreview(preview.document)
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

  const sections = labeledSections(items)

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
        // A "select all that apply" item (more than one correct letter --
        // see collectItems()'s comma-joined correct_answer) gets a hint
        // so the student knows to write more than one letter.
        const isMultiAnswer = section.name === 'Multiple Choice' && item.correct_answer.includes(',')
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
              ...(isMultiAnswer
                ? [new TextRun({ text: '  (Select all that apply)', italics: true, size: 20, color: '6b7280' })]
                : []),
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

        <!-- Test sections -- each one picks its own question type, in the
             order the teacher builds them (see qbSections in the script). -->
        <div v-for="(section, sIdx) in qbSections" :key="section.uid" class="qb-section">
          <div class="qb-section-header">
            <span class="qb-index">{{ ROMAN[sIdx] || sIdx + 1 }}.</span>
            <select
              :value="section.type"
              title="Choose this test section's question type."
              @change="onSectionTypeChange(section, $event.target.value)"
            >
              <option v-for="t in availableTypesFor(section)" :key="t" :value="t">{{ t }}</option>
            </select>
            <button
              class="btn btn-danger btn-small"
              title="Remove this test section and all of its questions."
              @click="removeSection(section.uid)"
            >
              Remove Test Section
            </button>
          </div>

          <!-- Multiple Choice -->
          <template v-if="section.type === 'Multiple Choice'">
            <div v-for="(item, idx) in section.items" :key="item.uid" class="mc-card">
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
                  aria-label="Remove this question"
                  @click="removeItemFromSection(section, item.uid)"
                >
                  ✕
                </button>
              </div>
              <div class="mc-choices">
                <label v-for="letter in MC_LETTERS" :key="letter" class="mc-choice">
                  <input
                    v-model="item.correct"
                    type="checkbox"
                    :value="letter"
                    title="Mark as (one of) the correct choice(s) -- check more than one for a select-all-that-apply question."
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
            <div v-if="!section.items.length" class="muted-text mb-8">No multiple choice questions yet.</div>
            <button class="btn btn-secondary" title="Add a multiple choice question." @click="addItemToSection(section)">
              + Add Multiple Choice Question
            </button>
          </template>

          <!-- True or False -->
          <template v-else-if="section.type === 'True or False'">
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr><th>#</th><th>Statement</th><th>Correct</th><th>Points</th><th>Threshold</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in section.items" :key="item.uid">
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
                      <button class="btn btn-danger btn-small" title="Remove this statement." aria-label="Remove this statement" @click="removeItemFromSection(section, item.uid)">✕</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="!section.items.length" class="muted-text mb-8 mt-8">No true or false statements yet.</div>
            <button class="btn btn-secondary mt-8" title="Add a true or false statement." @click="addItemToSection(section)">
              + Add True or False Question
            </button>
          </template>

          <!-- Identification -->
          <template v-else-if="section.type === 'Identification'">
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr><th>#</th><th>Question</th><th>Correct Answer</th><th>Alternative Answers</th><th>Points</th><th>Threshold</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in section.items" :key="item.uid">
                    <td style="text-align:center;font-weight:700;">{{ idx + 1 }}</td>
                    <td><input v-model="item.question_text" type="text" title="Question text"></td>
                    <td><input v-model="item.correct" type="text" title="Correct answer"></td>
                    <td><input v-model="item.alternatives" type="text" title="Alternative answers"></td>
                    <td><input v-model.number="item.points" type="number" style="text-align:center;width:60px;" title="Points"></td>
                    <td><input v-model.number="item.threshold" type="number" style="text-align:center;width:70px;" title="Fuzzy match threshold %"></td>
                    <td>
                      <button class="btn btn-danger btn-small" title="Remove this question." aria-label="Remove this question" @click="removeItemFromSection(section, item.uid)">✕</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="!section.items.length" class="muted-text mb-8 mt-8">No identification questions yet.</div>
            <button class="btn btn-secondary mt-8" title="Add an identification question." @click="addItemToSection(section)">
              + Add Identification Question
            </button>
          </template>

          <!-- Enumeration -->
          <template v-else-if="section.type === 'Enumeration'">
            <div v-for="(group, idx) in section.items" :key="group.uid" class="enum-group">
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
                  aria-label="Remove this enumeration question"
                  @click="removeItemFromSection(section, group.uid)"
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
                  aria-label="Remove this answer"
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
            <div v-if="!section.items.length" class="muted-text mb-8">No enumeration questions yet.</div>
            <button class="btn btn-secondary" title="Add an enumeration question." @click="addItemToSection(section)">
              + Add Enumeration Question
            </button>
          </template>
        </div>

        <div class="qb-add-section">
          <button
            class="btn btn-secondary"
            :disabled="!canAddSection"
            :title="canAddSection ? 'Add another test section with a different question type.' : 'All four question types are already in use.'"
            @click="addSection"
          >
            + Add Test Section
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
