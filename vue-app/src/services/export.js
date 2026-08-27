/* ============================================================
   services/export.js — session export to Excel / CSV
   Ported from App.exportSessionToFile() and its helpers in app.js.

   This lived on the App object in the original because both the
   Results and Reports pages needed it. It is a service here for the
   same reason — it is not view logic and neither page should own it.

   SheetJS (XLSX) is a global from the CDN script tag in index.html,
   not an npm import: the maintainers no longer publish `xlsx` to the
   public registry. The `typeof XLSX !== 'undefined'` guard is kept
   from the original, so a blocked CDN degrades to CSV rather than
   throwing.
   ============================================================ */

import { API } from '@/services/api.js'
import { showMessage } from '@/services/dialog.js'

export async function exportSessionToFile(sessionId) {
  const id = parseInt(sessionId) || null
  if (!id) {
    showMessage('No Session', 'No grading session to export.')
    return null
  }

  const results = await API.studentResults(id)
  if (!results.length) {
    showMessage('No Data', 'No results in this session to export.')
    return null
  }

  const prefs = await API.getExportPreferences()
  const requestedFilename = await formatExportFilename(id, prefs)
  const summaryData = buildSummaryRows(results, prefs)
  const detailData = prefs.include_item_scores ? await buildDetailRows(results, prefs) : null
  const forceCsv = /\.csv$/i.test(requestedFilename)

  if (!forceCsv && typeof XLSX !== 'undefined') {
    const filename = requestedFilename.replace(/\.csv$/i, '.xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryData), 'Results')
    if (detailData && detailData.length > 1) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(detailData), 'Item Details')
    }
    XLSX.writeFile(workbook, filename)
    showMessage('Exported', `Excel file downloaded: ${filename}`)
    return filename
  }

  const filename = requestedFilename.replace(/\.xlsx$/i, '.csv')
  const csvRows =
    detailData && detailData.length > 1
      ? [...summaryData, [], ['Item Details'], ...detailData]
      : summaryData
  downloadCsv(csvRows, filename)
  showMessage('Exported', `CSV file downloaded: ${filename}`)
  return filename
}

function buildSummaryRows(results, prefs) {
  const header = ['#']
  if (prefs.include_student_info) header.push('Student Name', 'Section')
  if (prefs.include_total_score) header.push('Score', 'Total', '% Score')
  if (prefs.include_flagged_notes) header.push('Flagged', 'Status')

  const rows = [header]
  results.forEach((result, index) => {
    const row = [index + 1]
    if (prefs.include_student_info) row.push(result.student_name || '', result.section || '')
    if (prefs.include_total_score) row.push(result.score, result.total, result.percentage)
    if (prefs.include_flagged_notes) row.push(result.flagged_count, result.status)
    rows.push(row)
  })
  return rows
}

async function buildDetailRows(results, prefs) {
  const header = []
  if (prefs.include_student_info) header.push('Student', 'Section')
  header.push('Item #')
  if (prefs.include_question_type) header.push('Type')
  header.push('Student Answer', 'Correct Answer')
  header.push('Match %', 'Points', 'Earned')
  header.push('Status', 'Model')
  if (prefs.include_flagged_notes) header.push('Remarks')

  const itemLists = await Promise.all(results.map((result) => API.resultItems(result.id)))

  const rows = [header]
  results.forEach((result, index) => {
    for (const item of itemLists[index]) {
      const row = []
      if (prefs.include_student_info) row.push(result.student_name || '', result.section || '')
      row.push(item.item_no)
      if (prefs.include_question_type) row.push(item.type || '')
      row.push(item.student_answer || '', item.correct_answer || '')
      row.push(item.match_score || 0, item.points || 0, item.earned || 0)
      row.push(item.status || '', item.model_used || '')
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
