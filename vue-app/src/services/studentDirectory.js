/* ============================================================
   services/studentDirectory.js — cross-session student/answer-key rollups
   Shared by ResultsView's cross-session search and StudentsView, so both
   read every session's results the same way instead of each re-implementing
   the same Promise.all fan-out.
   ============================================================ */

import { API } from '@/services/api.js'
import { canonicalSection } from './sections.js'
export { canonicalSection } from './sections.js'

/* One row per graded sheet, each carrying its own session. This is the
   full "every result in every session" fan-out -- callers group/filter it
   however they need (a name search, a per-student rollup, a per-answer-key
   rollup) rather than this module guessing which one is wanted. */
export async function loadAllGradedRecords() {
  const sessions = await API.sessions()
  const resultLists = await Promise.all(sessions.map((session) => API.studentResults(session.id)))
  const records = []
  sessions.forEach((session, index) => {
    for (const result of resultLists[index]) {
      records.push({ ...result, session })
    }
  })
  return records
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

/* Groups records by recognized name AND normalized section. There is no
   persistent student master list in this project, but keeping the section in
   the group key avoids incorrectly merging two students who happen to share
   a name in different classes. */
export function groupByStudent(records) {
  const groups = new Map()
  for (const record of records) {
    const name = (record.student_name || '').trim()
    if (!name) continue
    const section = canonicalSection(record.section)
    const key = `${name.toLowerCase()}|${section.toLowerCase()}`
    if (!groups.has(key)) {
      groups.set(key, { key, name, section, records: [] })
    }
    const group = groups.get(key)
    group.records.push(record)
  }

  return [...groups.values()]
    .map((group) => {
      const sheets = group.records.length
      const percentSum = group.records.reduce((sum, r) => sum + toNumber(r.percentage), 0)
      return {
        key: group.key,
        name: group.name,
        section: group.section,
        sheets,
        average: sheets ? Math.round((percentSum / sheets) * 100) / 100 : 0,
        records: group.records.sort(
          (a, b) => new Date(b.session.created_at) - new Date(a.session.created_at),
        ),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/* Groups records by answer key (via the session they belong to), counting
   sheets graded per key across every session that used it. */
export function groupByAnswerKey(records) {
  const groups = new Map()
  for (const record of records) {
    const name = record.session.answer_key_name || 'No key'
    if (!groups.has(name)) {
      groups.set(name, { name, sheets: 0, percentSum: 0, sessionIds: new Set() })
    }
    const group = groups.get(name)
    group.sheets += 1
    group.percentSum += toNumber(record.percentage)
    group.sessionIds.add(record.session.id)
  }
  return [...groups.values()]
    .map((g) => ({
      name: g.name,
      sheets: g.sheets,
      sessions: g.sessionIds.size,
      average: g.sheets ? Math.round((g.percentSum / g.sheets) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.sheets - a.sheets)
}

// A common passing-grade convention at CHED/DepEd-aligned institutions
// (75%) -- used only to flag a student worth a closer look on the Students
// page, not as a pass/fail determination the app makes on the teacher's
// behalf. Change this one constant if your institution uses a different mark.
export const ATTENTION_THRESHOLD = 75

export function needsAttention(student) {
  return student.sheets > 0 && student.average < ATTENTION_THRESHOLD
}

/* Every record whose name/section/status/answer-key text contains needle
   (case-insensitive). Used by both the Results page's search box and the
   Students page. */
export function searchRecords(records, needle) {
  const term = needle.trim().toLowerCase()
  if (!term) return []
  return records.filter((record) =>
    [record.student_name, canonicalSection(record.section), record.status, record.session.answer_key_name]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
}
