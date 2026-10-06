import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreByType } from '../src/services/scoreSummary.js'

test('separate weighted scores reflect final earned points and pending review', () => {
  const scores = scoreByType([
    { type: 'Multiple Choice', earned: 2, points: 2, status: 'correct' },
    { type: 'Multiple Choice', earned: 0, points: 1, status: 'incorrect' },
    { type: 'True or False', earned: 1, points: 1, status: 'correct' },
    { type: 'Identification', earned: 0, points: 3, status: 'flagged' },
    { type: 'Enumeration', earned: '0.5', points: '1', status: 'correct' },
    { type: 'Enumeration', earned: 0.5, points: 1, status: 'correct', manual_override: true },
  ])
  assert.deepEqual(scores.map(s => [s.type, s.earned, s.total, s.flagged]), [
    ['Multiple Choice', 2, 3, 0], ['True or False', 1, 1, 0],
    ['Identification', 0, 3, 1], ['Enumeration', 1, 2, 0],
  ])
  assert.equal(scores.reduce((sum, score) => sum + score.earned, 0), 4)
})

test('empty results and invalid numeric fields are safe', () => {
  assert.deepEqual(scoreByType([]), [])
  assert.equal(scoreByType([{ earned: 'bad', points: undefined }])[0].earned, 0)
})
