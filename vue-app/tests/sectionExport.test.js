import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalSection } from '../src/services/sections.js'
import { questionnaireSessions, sectionExportRecords } from '../src/services/sectionExport.js'

const sessions = [
  { id: 1, answer_key_id: 4, status: 'Completed', created_at: '2026-10-01' },
  { id: 2, answer_key_id: 4, status: 'Completed', created_at: '2026-10-02' },
  { id: 3, answer_key_id: 5, status: 'Completed' },
  { id: 4, answer_key_id: 4, status: 'Cancelled' },
  { id: 5, answer_key_id: 4, status: 'Processing' },
  { id: 6, answer_key_id: 4, status: 'Failed' },
]
test('only completed sessions of the exact questionnaire ID qualify', () => {
  assert.deepEqual(questionnaireSessions(sessions, '4').map(s => s.id), [1, 2])
  assert.deepEqual(questionnaireSessions(sessions, ''), [])
})
test('section aliases match without merging distinct classes', () => {
  for (const text of ['BS INFO TECH 2-B', 'BSINFOTECH 2-B', 'bs info tech 2 b']) {
    assert.equal(canonicalSection(text), 'BS INFOTECH 2-B')
  }
  for (const text of ['BSCS 1A', 'BSCS 1 - A', 'bscs 1_a']) {
    assert.equal(canonicalSection(text), 'BSCS 1-A')
  }
  assert.notEqual(canonicalSection('BSCS 1B'), canonicalSection('BSCS 1A'))
})
test('filters all records across sessions, preserves retakes and manual scores', () => {
  const records = sessions.map((session, i) => ({
    id: i + 1, student_name: 'Same Student', section: 'BSCS 1 - A', score: 2.5, session,
  }))
  records.push({ id: 10, student_name: 'Other Section', section: 'BSCS 1B', session: sessions[0] })
  records.push({ id: 11, student_name: 'Unknown', section: '', session: sessions[0] })
  const selected = sectionExportRecords(records, 4, 'BSCS 1A')
  assert.deepEqual(selected.map(r => r.id), [1, 2])
  assert.ok(selected.every(r => r.section === 'BSCS 1-A' && r.score === 2.5))
  assert.equal(records[0].section, 'BSCS 1 - A', 'does not mutate stored records')
  assert.deepEqual(sectionExportRecords(records, 4, ''), [])
  assert.deepEqual(sectionExportRecords(records, 4, 'BSCS 3-A'), [])
})
