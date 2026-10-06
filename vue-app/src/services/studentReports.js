import { canonicalSection } from './sections.js'

function resultTime(record) {
  const time = Date.parse(record.created_at || record.session?.created_at || '')
  return Number.isFinite(time) ? time : 0
}

// Students has no persistent student ID: match normalized name and section,
// while keeping each questionnaire separate even when titles are identical.
export function reportStudentKey(record) {
  const name = String(record.student_name || '').trim().replace(/\s+/g, ' ').toLowerCase()
  return JSON.stringify([record.session?.answer_key_id, canonicalSection(record.section), name || `unnamed-result-${record.id}`])
}

export function studentReportRows(records, {
  questionnaireId = '', section = '', dateFrom = '', dateTo = '', sort = 'name-asc',
} = {}) {
  const normalizedSection = canonicalSection(section)
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null
  const students = new Map()
  for (const record of records) {
    if (record.session?.status !== 'Completed') continue
    if (questionnaireId && String(record.session.answer_key_id) !== String(questionnaireId)) continue
    if (normalizedSection && canonicalSection(record.section) !== normalizedSection) continue
    const time = resultTime(record)
    if ((from !== null && time < from) || (to !== null && time > to)) continue
    const key = reportStudentKey(record)
    const previous = students.get(key)
    if (!previous || time > resultTime(previous) || (time === resultTime(previous) && Number(record.id) > Number(previous.id))) {
      students.set(key, { ...record, key, section: canonicalSection(record.section) })
    }
  }
  const byName = (a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')) ||
    a.section.localeCompare(b.section) || String(a.session.answer_key_id).localeCompare(String(b.session.answer_key_id)) || a.id - b.id
  const score = (record) => Number.isFinite(Number(record.score)) ? Number(record.score) : 0
  return [...students.values()].sort((a, b) => {
    if (sort === 'score-desc') return score(b) - score(a) || byName(a, b)
    if (sort === 'score-asc') return score(a) - score(b) || byName(a, b)
    if (sort === 'name-desc') return -byName(a, b)
    return byName(a, b)
  })
}
