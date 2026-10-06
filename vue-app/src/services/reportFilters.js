import { canonicalSection } from './sections.js'

export function isStudentReportMode(questionnaireId, section) {
  return Boolean(questionnaireId || section)
}

// The table and exports share the same visible session scope. With a section
// selected, row totals describe that section rather than the whole session.
export function filterReportSessions(sessions, records, {
  questionnaireId = '', section = '', dateFrom = '', dateTo = '',
} = {}) {
  const normalizedSection = canonicalSection(section)
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null
  const bySession = new Map()
  for (const record of records) {
    if (normalizedSection && canonicalSection(record.section) !== normalizedSection) continue
    const id = record.session.id
    if (!bySession.has(id)) bySession.set(id, [])
    bySession.get(id).push(record)
  }
  const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
  return sessions.filter((session) => {
    if (questionnaireId && String(session.answer_key_id) !== String(questionnaireId)) return false
    if (normalizedSection && !bySession.has(session.id)) return false
    const created = new Date(session.created_at)
    return !(from && created < from) && !(to && created > to)
  }).map((session) => {
    const results = bySession.get(session.id) || []
    const average = results.reduce((sum, result) => sum + numeric(result.percentage), 0)
    return {
      ...session,
      sheets: results.length,
      average: results.length ? Math.round(average / results.length * 100) / 100 : 0,
      flagged: results.reduce((sum, result) => sum + numeric(result.flagged_count), 0),
    }
  })
}
