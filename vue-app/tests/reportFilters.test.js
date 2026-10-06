import test from 'node:test'
import assert from 'node:assert/strict'
import { filterReportSessions, isStudentReportMode } from '../src/services/reportFilters.js'

test('reports default to sessions and switch to students for either scope filter', () => {
  assert.equal(isStudentReportMode('', ''), false)
  assert.equal(isStudentReportMode('19', ''), true)
  assert.equal(isStudentReportMode('', 'BSCS 1A'), true)
  assert.equal(isStudentReportMode('19', 'BSCS 1A'), true)
  assert.equal(isStudentReportMode('', ''), false)
})

const sessions = [
  { id: 1, answer_key_id: 4, answer_key_name: 'Same title', created_at: '2026-10-01T12:00:00', status: 'Completed' },
  { id: 2, answer_key_id: 4, answer_key_name: 'Same title', created_at: '2026-10-02T23:59:59', status: 'Completed' },
  { id: 3, answer_key_id: 5, answer_key_name: 'Same title', created_at: '2026-10-02T12:00:00', status: 'Completed' },
]
const records = [
  { session: sessions[0], section: 'BSCS 1A', percentage: 80, flagged_count: 1 },
  { session: sessions[0], section: 'BSCS 1 - A', percentage: 100, flagged_count: 2 },
  { session: sessions[0], section: 'BSCS 1B', percentage: 0, flagged_count: 10 },
  { session: sessions[1], section: 'BSCS 1B', percentage: 50, flagged_count: 0 },
  { session: sessions[2], section: 'BSCS 1A', percentage: 60, flagged_count: 0 },
]
test('questionnaire and normalized section jointly filter sessions and their totals', () => {
  const rows = filterReportSessions(sessions, records, { questionnaireId: '4', section: 'BSCS 1-A' })
  assert.deepEqual(rows.map(r => r.id), [1])
  assert.equal(rows[0].sheets, 2)
  assert.equal(rows[0].average, 90)
  assert.equal(rows[0].flagged, 3)
})
test('all filters cleared restores all sessions; each filter works alone', () => {
  assert.equal(filterReportSessions(sessions, records).length, 3)
  assert.equal(filterReportSessions(sessions, records)[0].sheets, 3)
  assert.deepEqual(filterReportSessions(sessions, records, { questionnaireId: 4 }).map(r => r.id), [1, 2])
  assert.deepEqual(filterReportSessions(sessions, records, { section: 'BSCS 1A' }).map(r => r.id), [1, 3])
})
test('date boundaries are inclusive and an empty combination shows no sessions', () => {
  const rows = filterReportSessions(sessions, records, { questionnaireId: 4, dateFrom: '2026-10-02', dateTo: '2026-10-02' })
  assert.deepEqual(rows.map(r => r.id), [2])
  assert.deepEqual(filterReportSessions(sessions, records, { questionnaireId: 4, section: 'BSCS 3A' }), [])
})
test('filters search past the former first-100-session cap', () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ ...sessions[0], id: i + 1 }))
  const rows = filterReportSessions(many, [{ ...records[0], session: many[100] }], { section: 'BSCS 1A' })
  assert.deepEqual(rows.map(r => r.id), [101])
})
