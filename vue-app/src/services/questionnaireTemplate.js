/* ============================================================
   services/questionnaireTemplate.js — the one real exam-paper layout

   Shared by AnswerKeyView.vue (Preview/Print for a real saved answer
   key) and SettingsView.vue (the generic example template a teacher
   downloads to see the paper format before building a real key) --
   extracted here specifically so there is exactly one place that knows
   what a printed questionnaire looks like. Two separate copies drifted
   apart before (the Settings example was a bare "Item # / Question
   Type / Answer" table nothing like the real underline-blank format
   the YOLO detector is trained to find); importing the same functions
   is what keeps that from happening again silently.
   ============================================================ */

export const Q_TYPES = ['Multiple Choice', 'True or False', 'Identification', 'Enumeration']
export const ROMAN = ['I', 'II', 'III', 'IV']

export const SECTION_META = {
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

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

/* Labels sections purely by the order their types first appear in
   `items` (collectItems() in AnswerKeyView.vue always writes one
   type's items as one contiguous block) -- I, II, III... reflect
   whatever was actually built, never a fixed type-to-numeral mapping. */
export function labeledSections(items) {
  const order = []
  items.forEach((item) => {
    if (Q_TYPES.includes(item.type) && !order.includes(item.type)) order.push(item.type)
  })
  return order
    .map((name, idx) => ({ label: ROMAN[idx] || String(idx + 1), name, items: items.filter((i) => i.type === name) }))
    .filter((section) => section.items.length)
}

/* A4 at 96 CSS px/inch (210mm/297mm), matching @page { size: A4 } below. */
export const PAGE_WIDTH_PX = 794
export const PAGE_HEIGHT_PX = 1123
export const PAGE_MARGIN_PX = 96
const PAGE_CONTENT_HEIGHT_PX = PAGE_HEIGHT_PX - PAGE_MARGIN_PX * 2

/* Builds the full standalone printable HTML document for one
   questionnaire. `title` is shown as the page <title> and used for
   nothing else (a real answer key's own name, or a fixed label for the
   generic example). `items` is the same shape collectItems() produces
   in AnswerKeyView.vue: { item_no, type, question_text, choices,
   correct_answer, enum_group, ... }. */
export function questionnaireHtml(title, items) {
  const safeTitle = escapeHtml(title)
  const sections = labeledSections(items)

  let sectionsHtml = ''
  // Runs across the whole questionnaire, not per section -- if section I
  // has 5 questions, section II's first question displays as 6, not 1.
  let displayNo = 0
  sections.forEach((section) => {
    const meta = SECTION_META[section.name]
    // Slug drives the 1.5 line-spacing rule below, which applies to every
    // section type except Multiple Choice (see .section-* rules in
    // <style>) -- put directly on .section-title/.block themselves (no
    // wrapping .section div) so paginatePreview() can treat every one of
    // them as an independently movable, self-contained top-level node.
    const slug = section.name.toLowerCase().replace(/[^a-z]+/g, '-')
    sectionsHtml += `<div class="section-title section-${slug}"><strong>${section.label}. ${escapeHtml(section.name)}.</strong> ${meta.instruction}</div>`

    if (section.name === 'Enumeration') {
      const groups = new Map()
      section.items.forEach((item) => {
        if (!groups.has(item.enum_group)) groups.set(item.enum_group, [])
        groups.get(item.enum_group).push(item)
      })
      for (const groupItems of groups.values()) {
        displayNo += 1
        // Wrapped in one block so a page break never lands between the
        // prompt and its blanks, or between two of that group's blanks.
        sectionsHtml += `<div class="block section-${slug}"><div class="q-prompt">${displayNo}. ${escapeHtml(groupItems[0].question_text)}</div><div class="enum-blanks">`
        groupItems.forEach(() => {
          sectionsHtml += `<div class="blank-line">- <span class="blank"></span></div>`
        })
        sectionsHtml += `</div></div>`
      }
    } else {
      section.items.forEach((item) => {
        displayNo += 1
        // A "select all that apply" item (more than one correct letter --
        // see collectItems()'s comma-joined correct_answer) gets a hint
        // so the student knows to write more than one letter.
        const multiAnswerHint = section.name === 'Multiple Choice' && item.correct_answer.includes(',')
          ? ' <span class="mc-hint">(Select all that apply)</span>'
          : ''
        // Wrapped in one block so a page break never separates a question
        // from its own choices.
        sectionsHtml += `<div class="block section-${slug}"><div class="q-line"><span class="blank"></span>${displayNo}. ${escapeHtml(item.question_text)}${multiAnswerHint}</div>`
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
  })

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      max-width: 820px; margin: 28px auto; padding: 0 24px;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
      color: #1f2937;
    }
    .fields {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px 28px;
      margin: 12px 0 24px;
    }
    .field-row { display: flex; align-items: flex-end; gap: 8px; white-space: nowrap; font-size: 13px; color: #4b5563; }
    .line { flex: 1; min-height: 1px; margin-bottom: 2px; border-bottom: 1px solid #111827; }
    /* Label and instruction share one line ("I. Multiple Choice. Write
       the correct answer...") -- the <strong> inside the template covers
       just the label/name, so it bolds without needing a separate rule
       here. .section-title is a direct, independently-movable child of
       #flow (see paginatePreview()), with nothing wrapping it. */
    .section-title {
      font-size: 9px; color: #000; margin: 22px 0 8px;
      break-after: avoid; page-break-after: avoid;
    }
    /* Keeps a question and its own choices/blanks together -- without
       this a page break can land between a question and its answer
       lines, splitting one item across two sheets. */
    .block { break-inside: avoid; page-break-inside: avoid; }
    .q-line, .q-prompt { margin: 10px 0 4px; font-size: 9px; }
    /* 1.5 line spacing for True/False, Identification, and Enumeration
       only -- Multiple Choice keeps the browser default (~1.2) since its
       questions are already visually separated by their own choices grid. */
    .section-true-or-false .q-line,
    .section-identification .q-line,
    .section-enumeration .q-prompt {
      line-height: 1.5;
    }
    /* True/False keeps this base width (its answer is just "TRUE"/"FALSE").
       Identification gets a longer blank since its answers are actual
       words/phrases, and Enumeration's answer blanks (the "- ___" lines,
       the only place .blank appears in that section -- the item number
       itself has no leading blank there) get twice that again, for the
       same reason plus generally longer answers. */
    .blank { display: inline-block; min-width: 60px; border-bottom: 1px solid #111827; margin-right: 6px; }
    .section-identification .blank { min-width: 90px; }
    .section-enumeration .blank { min-width: 180px; }
    .choices { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; margin: 2px 0 10px 66px; color: #4b5563; font-size: 9px; }
    .mc-hint { font-style: italic; color: #6b7280; font-size: 12px; }
    .enum-blanks { margin-left: 20px; }
    .blank-line { margin: 6px 0; }
    .print { margin: 0 0 18px; padding: 9px 16px; border: 0; border-radius: 6px; background: #1f6fb2; color: white; cursor: pointer; font-weight: 600; }
    .print:hover { background: #185c96; }
    /* The actual paper margin used when printing/saving as PDF -- distinct
       from .preview-page-content's padding below, which only affects the
       on-screen preview's page boxes. Auto-pagination for overflowing
       content is the browser's native print behavior; this just makes it
       1" on every sheet instead of whatever the browser/printer defaults
       to. */
    @page { size: A4; margin: 1in; }

    /* #flow is the one real, unbroken copy of the document -- what
       @media print below actually lays out onto paper, completely
       unchanged. #pages is a second, on-screen-only copy of the same
       nodes (moved there by paginatePreview(), not duplicated) sliced
       into fixed-size boxes so the plain preview window shows separate
       sheets instead of one continuous scroll -- browsers don't expose a
       "paged" layout mode outside of actual print, so this is built by
       hand rather than left to CSS alone. */
    #pages { display: block; }
    #flow { display: none; }
    .preview-page {
      width: ${PAGE_WIDTH_PX}px; min-height: ${PAGE_HEIGHT_PX}px;
      margin: 0 auto 24px; background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,.2);
    }
    /* No min-height here on purpose -- .preview-page above already gives
       a short last page the full-sheet look via ITS OWN min-height, so
       this only needs to be as tall as its real content (a min-height:100%
       here previously fought getBoundingClientRect()'s measurement and
       forced a page break far earlier than the content actually needed). */
    .preview-page-content {
      width: 100%; padding: ${PAGE_MARGIN_PX}px; box-sizing: border-box;
    }
    @media print {
      #pages { display: none; }
      #flow { display: block; }
      body { margin: 0; max-width: none; padding: 0; }
      .print { display: none; }
    }
  </style>
</head>
<body>
  <button class="print" onclick="window.print()">Print</button>
  <div id="flow">
    <div class="fields">
      <div class="field-row">Name:<div class="line"></div></div>
      <div class="field-row">Date:<div class="line"></div></div>
      <div class="field-row">Section:<div class="line"></div></div>
      <div class="field-row">Score:<div class="line"></div></div>
    </div>
    ${sectionsHtml}
  </div>
  <div id="pages"></div>
</body>
</html>`
}

/* Builds #pages from CLONES of #flow's children (one .fields grid, then
   each .section-title/.block in document order), packing each clone
   into a growing page box and starting a fresh one whenever the current
   page would exceed one sheet's usable height.

   Cloning, not moving, is required here: moving #flow's real children
   directly would leave #flow empty afterward, and @media print shows
   #flow for the real printed/PDF output -- an emptied #flow means every
   actual print comes out as one blank page. Cloning leaves #flow's
   original content untouched for print while #pages gets its own
   independent, safely-splittable copies for the on-screen preview. */
export function paginatePreview(doc) {
  const flow = doc.getElementById('flow')
  const pages = doc.getElementById('pages')
  const nodes = Array.from(flow.children).map((node) => node.cloneNode(true))

  function newPage() {
    const page = doc.createElement('div')
    page.className = 'preview-page'
    const content = doc.createElement('div')
    content.className = 'preview-page-content'
    page.appendChild(content)
    pages.appendChild(page)
    return content
  }

  let content = newPage()
  nodes.forEach((node) => {
    content.appendChild(node)
    // getBoundingClientRect().height, not scrollHeight -- scrollHeight
    // rounds to a whole pixel on every call, and that rounding error
    // compounds over many small elements; the rect stays sub-pixel exact.
    // The >1 guard means a single element taller than one whole page
    // (shouldn't happen with real exam content) still gets placed rather
    // than causing an infinite loop of empty pages.
    if (content.getBoundingClientRect().height > PAGE_CONTENT_HEIGHT_PX && content.children.length > 1) {
      content.removeChild(node)
      content = newPage()
      content.appendChild(node)
    }
  })
}
