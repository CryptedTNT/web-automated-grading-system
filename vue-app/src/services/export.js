/* ============================================================
   services/export.js — session export to Excel / CSV
   Ported from App.exportSessionToFile() and its helpers in app.js.

   This lived on the App object in the original because both the
   Results and Reports pages needed it. It is a service here for the
   same reason — it is not view logic and neither page should own it.

   SheetJS (XLSX) is a global from its CDN, not an npm import: the
   maintainers no longer publish `xlsx` to the public registry. It is
   loaded the first time someone exports (loadSheetJs below) instead of
   by a script tag in index.html, where its 288 KB blocked the first
   paint of every page. If the CDN cannot be reached the export
   degrades to CSV rather than throwing, as before.
   ============================================================ */

import { API } from '@/services/api.js'
import { showMessage } from '@/services/dialog.js'
import { questionnaireSessions, sectionExportRecords } from './sectionExport.js'
import { canonicalSection } from './sections.js'

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
const SHEETJS_INTEGRITY = 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT'
let sheetJsLoading = null

/* Resolves true once the global XLSX exists, false if it could not be loaded. */
function loadSheetJs() {
  if (typeof XLSX !== 'undefined') return Promise.resolve(true)
  if (!sheetJsLoading) {
    sheetJsLoading = new Promise((resolve) => {
      const tag = document.createElement('script')
      tag.src = SHEETJS_URL
      tag.integrity = SHEETJS_INTEGRITY
      tag.crossOrigin = 'anonymous'
      tag.onload = () => resolve(typeof XLSX !== 'undefined')
      tag.onerror = () => {
        tag.remove()
        sheetJsLoading = null // allow a retry on the next export
        resolve(false)
      }
      document.head.appendChild(tag)
    })
  }
  return sheetJsLoading
}

/* Excel/LibreOffice treat any cell that STARTS WITH =, +, -, @, or a tab
   evaluate it as a formula regardless of whether the file is .xlsx or
   .csv, and older Excel/LibreOffice builds resolve that into DDE command
   execution on open -- so a teacher's own typed correction (ReviewView's
   "corrected answer" goes straight into student_answer/remarks below) or
   an unlucky OCR read starting with one of those characters would carry
   through untouched otherwise. Prefixing with a straight quote is the
   standard neutralization: both formats then render it as plain text. */
const FORMULA_LEAD_RE = /^[=+\-@\t\r]/
function sanitizeCell(value) {
  return typeof value === 'string' && FORMULA_LEAD_RE.test(value) ? `'${value}` : value
}
function sanitizeRows(rows) {
  return rows.map((row) => row.map(sanitizeCell))
}

export async function exportSessionToFile(sessionId, { announce = true, section = '' } = {}) {
  const id = parseInt(sessionId) || null
  if (!id) {
    if (announce) showMessage('No Session', 'No grading session to export.')
    return null
  }

  const allResults = await API.studentResults(id)
  const normalizedSection = canonicalSection(section)
  const results = normalizedSection
    ? allResults.filter((result) => canonicalSection(result.section) === normalizedSection)
      .map((result) => ({ ...result, section: normalizedSection }))
    : allResults
  if (!results.length) {
    if (announce) showMessage('No Data', 'No results in this session to export.')
    return null
  }

  const prefs = await API.getExportPreferences()
  let requestedFilename = await formatExportFilename(id, prefs)
  if (normalizedSection) {
    const suffix = normalizedSection.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_')
    requestedFilename = requestedFilename.replace(/\.(xlsx|csv)$/i, `_${suffix}.$1`)
  }
  return exportResultsToFile(results, prefs, requestedFilename, announce)
}

export async function exportSectionToFile(questionnaireId, section, { sessionIds = null } = {}) {
  // Re-read at export time so saved identity/grade corrections are included.
  const sessions = questionnaireSessions(await API.sessions(), questionnaireId)
    .filter((session) => sessionIds === null || sessionIds.includes(session.id))
  const lists = await Promise.all(sessions.map((session) => API.studentResults(session.id)))
  const records = lists.flatMap((results, index) =>
    results.map((result) => ({ ...result, session: sessions[index] })),
  )
  const results = sectionExportRecords(records, questionnaireId, section)
  if (!results.length) {
    await showMessage('No Matching Students', 'No completed submissions match this questionnaire and section.')
    return null
  }
  const prefs = await API.getExportPreferences()
  const name = sessions[0]?.answer_key_name || `questionnaire_${questionnaireId}`
  const filename = `${name}_${results[0].section}_${new Date().toISOString().slice(0, 10)}`
    .replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_') +
    (/\.csv$/i.test(prefs.filename_format || '') ? '.csv' : '.xlsx')
  return exportResultsToFile(results, prefs, filename, true, true)
}

export async function exportStudentsToFile(selectedRecords) {
  if (!selectedRecords.length) {
    await showMessage('No Students Selected', 'Select students or use the select-all checkbox first.')
    return null
  }
  const selected = [...new Map(selectedRecords.map((record) => [record.id, record])).values()]
  // Re-read only selected source groups through the existing ownership-checked
  // API. Fail as a whole if any selected record vanished, rather than quietly
  // downloading an incomplete class report.
  const owned = new Map((await API.sessions())
    .filter((session) => session.status === 'Completed').map((session) => [session.id, session]))
  const sessionIds = [...new Set(selected.map((record) => record.session.id))]
  if (sessionIds.some((id) => !owned.has(id))) {
    throw new Error('Some selected results are no longer available. Refresh Reports and select the students again.')
  }
  const lists = await Promise.all(sessionIds.map((id) => API.studentResults(id)))
  const current = new Map(lists.flatMap((results, index) =>
    results.map((result) => [result.id, { ...result, session: owned.get(sessionIds[index]), section: canonicalSection(result.section) }]),
  ))
  const results = selected.map((record) => current.get(record.id))
  if (results.some((record) => !record)) {
    throw new Error('Some selected students are no longer available. Refresh Reports and select the students again.')
  }
  const prefs = { ...await API.getExportPreferences(), include_student_info: true, include_total_score: true }
  const keys = [...new Set(results.map((record) => record.session.answer_key_id))]
  const sections = [...new Set(results.map((record) => record.section).filter(Boolean))]
  const questionnaire = keys.length === 1 ? results[0].session.answer_key_name || 'questionnaire' : 'selected_questionnaires'
  const section = sections.length === 1 ? sections[0] : 'selected_sections'
  const filename = `${questionnaire}_${section}_students_${new Date().toISOString().slice(0, 10)}.xlsx`
    .replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_')
  return exportResultsToFile(results, prefs, filename, true, 'students', { excelOnly: true })
}

async function exportResultsToFile(results, prefs, requestedFilename, announce, includeSession = false, { excelOnly = false } = {}) {
  const summaryData = sanitizeRows(buildSummaryRows(results, prefs, includeSession))
  const detailData = prefs.include_item_scores ? sanitizeRows(await buildDetailRows(results, prefs, includeSession)) : null
  const forceCsv = /\.csv$/i.test(requestedFilename)

  if (!forceCsv && (await loadSheetJs())) {
    const filename = requestedFilename.replace(/\.csv$/i, '.xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryData), 'Results')
    if (detailData && detailData.length > 1) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(detailData), 'Item Details')
    }
    XLSX.writeFile(workbook, filename)
    if (announce) showMessage('Exported', `Excel file downloaded: ${filename}`)
    return filename
  }

  if (excelOnly) throw new Error('The Excel export library could not be loaded. Check your connection and try again. No partial file was downloaded.')

  const filename = requestedFilename.replace(/\.xlsx$/i, '.csv')
  const csvRows =
    detailData && detailData.length > 1
      ? [...summaryData, [], ['Item Details'], ...detailData]
      : summaryData
  downloadCsv(csvRows, filename)
  if (announce) showMessage('Exported', `CSV file downloaded: ${filename}`)
  return filename
}

function buildSummaryRows(results, prefs, includeSession = false) {
  const header = ['#']
  if (includeSession === 'students') header.push('Questionnaire', 'Submission Date')
  else if (includeSession) header.push('Session ID', 'Session Date', 'Questionnaire')
  if (prefs.include_student_info) header.push('Student Name', 'Section')
  if (prefs.include_total_score) header.push('Score', 'Total', '% Score')
  if (prefs.include_flagged_notes) header.push('Flagged', 'Status')

  const rows = [header]
  results.forEach((result, index) => {
    const row = [index + 1]
    if (includeSession === 'students') row.push(result.session.answer_key_name || '', result.created_at || result.session.created_at)
    else if (includeSession) row.push(result.session.id, result.session.created_at, result.session.answer_key_name || '')
    if (prefs.include_student_info) row.push(result.student_name || '', result.section || '')
    if (prefs.include_total_score) row.push(result.score, result.total, result.percentage)
    if (prefs.include_flagged_notes) row.push(result.flagged_count, result.status)
    rows.push(row)
  })
  return rows
}

async function buildDetailRows(results, prefs, includeSession = false) {
  const header = []
  if (includeSession === 'students') header.push('Questionnaire', 'Submission Date')
  else if (includeSession) header.push('Session ID', 'Session Date', 'Questionnaire')
  if (prefs.include_student_info) header.push('Student', 'Section')
  header.push('Item #')
  if (prefs.include_question_type) header.push('Type')
  header.push('Student Answer', 'Correct Answer')
  header.push('Match %', 'Points', 'Earned')
  header.push('Status')
  if (prefs.include_flagged_notes) header.push('Remarks')

  const itemLists = await Promise.all(results.map((result) => API.resultItems(result.id)))

  const rows = [header]
  results.forEach((result, index) => {
    for (const item of itemLists[index]) {
      const row = []
      if (includeSession === 'students') row.push(result.session.answer_key_name || '', result.created_at || result.session.created_at)
      else if (includeSession) row.push(result.session.id, result.session.created_at, result.session.answer_key_name || '')
      if (prefs.include_student_info) row.push(result.student_name || '', result.section || '')
      row.push(item.item_no)
      if (prefs.include_question_type) row.push(item.type || '')
      row.push(item.student_answer || '', item.correct_answer || '')
      row.push(item.match_score || 0, item.points || 0, item.earned || 0)
      row.push(item.status || '')
      if (prefs.include_flagged_notes) row.push(item.remarks || '')
      rows.push(row)
    }
  })
  return rows
}

/* Expands the {session} {date} {answer_key} {subject} {section} tokens
   the Settings page lets the teacher configure, then strips anything
   Windows rejects in a filename. */
async function formatExportFilename(sessionId, prefs) {
  const [sessions, answerKeys, results] = await Promise.all([
    API.sessions(),
    API.answerKeys(),
    API.studentResults(sessionId),
  ])
  const session = sessions.find((s) => s.id === sessionId) || {}
  const answerKey = answerKeys.find((k) => k.id === session.answer_key_id) || {}
  const sections = [...new Set(results.map((r) => (r.section || '').trim()).filter(Boolean))]

  const tokens = {
    session: sessionId,
    date: new Date().toISOString().slice(0, 10),
    answer_key: session.answer_key_name || answerKey.name || 'answer_key',
    subject: answerKey.subject || answerKey.name || 'subject',
    section: sections.length === 1 ? sections[0] : 'all_sections',
  }

  let format = (prefs.filename_format || 'grading_session_{session}_{date}.xlsx').trim()
  if (!format) format = 'grading_session_{session}_{date}.xlsx'
  format = format.replace(/\{(session|date|answer_key|subject|section)\}/g, (_, key) => tokens[key])
  format = format.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_')
  if (!/\.(xlsx|csv)$/i.test(format)) format += '.xlsx'
  return format
}

function downloadCsv(rows, filename) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')

  /* The BOM is what tells Excel on Windows to read this as UTF-8.
     Without it the file is decoded as ANSI and names like "Peña"
     arrive as "PeÃ±a". */
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
