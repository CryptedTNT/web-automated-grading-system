import test from 'node:test'
import assert from 'node:assert/strict'
import { validManualScore } from '../src/services/manualScoring.js'
import { scoreByType } from '../src/services/scoreSummary.js'

test('manual score permits partial, zero, full, and two decimal places', () => {
  for (const score of [0, 2, 3, '2.25']) assert.equal(validManualScore(score, 3), true)
  for (const score of ['', null, -1, 4, '2.001', 'NaN', Infinity]) assert.equal(validManualScore(score, 3), false)
})

test('partial scores contribute to totals and no longer await review', () => {
  const [summary] = scoreByType([{ type: 'Identification', earned: 2, points: 3, status: 'partial' }])
  assert.equal(summary.earned, 2)
  assert.equal(summary.total, 3)
  assert.equal(summary.flagged, 0)
})
