import test from 'node:test'
import assert from 'node:assert/strict'
import { studentReportRows } from '../src/services/studentReports.js'

function record(id, name, score, { section = 'BSCS 1A', key = 4, date = '2026-10-01T12:00:00', status = 'Completed' } = {}) {
  return { id, student_name: name, section, score, created_at: date,
    session: { id, answer_key_id: key, answer_key_name: 'Same title', status, created_at: date } }
}
const records = [record(1, 'Amy', 30), record(2, 'Bob', 20), record(3, 'amy', 25, { date: '2026-10-02T12:00:00', section: 'BSCS 1 - A' }),
  record(4, 'Amy', 50, { key: 5 }), record(5, 'Different', 10, { section: 'BSCS 1B' }), record(6, 'Cancelled', 50, { status: 'Cancelled' })]
test('student rows use latest completed result per name, normalized section and questionnaire', () => {
  const rows = studentReportRows(records, { questionnaireId: '4', section: 'BSCS 1A' })
  assert.deepEqual(rows.map(row => row.id), [3, 2])
  assert.equal(rows[0].score, 25, 'latest result is used, not highest')
  assert.equal(rows[0].section, 'BSCS 1-A')
  assert.equal(studentReportRows(records).length, 4, 'different questionnaire and section remain separate')
})
test('name and numeric score sort in both directions without affecting chosen result', () => {
  const filters = { questionnaireId: 4, section: 'BSCS 1A' }
  assert.deepEqual(studentReportRows(records, { ...filters, sort: 'name-desc' }).map(r => r.id), [2, 3])
  assert.deepEqual(studentReportRows(records, { ...filters, sort: 'score-desc' }).map(r => r.score), [25, 20])
  assert.deepEqual(studentReportRows(records, { ...filters, sort: 'score-asc' }).map(r => r.score), [20, 25])
})
test('date filters choose latest submission within the range and exclude unsupported states', () => {
  assert.deepEqual(studentReportRows(records, { questionnaireId: 4, section: 'BSCS 1A', dateTo: '2026-10-01' }).map(r => r.id), [1, 2])
  assert.equal(studentReportRows(records, { dateFrom: '2026-10-03' }).length, 0)
  for (const status of ['Processing', 'Failed', 'Cancelled']) assert.equal(studentReportRows([record(10, 'A', 3, { status })]).length, 0)
})
test('name whitespace variants merge, missing names do not accidentally merge, timestamp ties use newest ID', () => {
  const rows = studentReportRows([record(1, 'Amy   Smith', 4), record(2, ' amy smith ', 5), record(3, '', 2), record(4, '', 3)])
  assert.equal(rows.length, 3)
  assert.ok(rows.some(r => r.id === 2))
})
