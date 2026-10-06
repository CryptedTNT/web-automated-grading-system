import { canonicalSection } from './sections.js'

export function questionnaireSessions(sessions, questionnaireId) {
  if (!questionnaireId) return []
  return sessions.filter((session) =>
    String(session.answer_key_id) === String(questionnaireId) && session.status === 'Completed',
  )
}

export function sectionExportRecords(records, questionnaireId, section) {
  const normalized = canonicalSection(section)
  if (!questionnaireId || !normalized) return []
  return records.filter((record) =>
    String(record.session?.answer_key_id) === String(questionnaireId) &&
    record.session?.status === 'Completed' && canonicalSection(record.section) === normalized,
  ).map((record) => ({ ...record, section: normalized }))
    .sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')) ||
      String(a.session.created_at).localeCompare(String(b.session.created_at)) || a.id - b.id)
}
