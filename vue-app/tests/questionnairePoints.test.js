import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedQuestionPoints } from '../src/services/questionnairePoints.js'

test('questionnaire points are constrained to 1–10', () => {
  for (const value of [0, -1, '', undefined]) assert.equal(boundedQuestionPoints(value), 1)
  assert.equal(boundedQuestionPoints(11), 10)
  assert.equal(boundedQuestionPoints(3), 3)
  assert.equal(boundedQuestionPoints(10), 10)
  assert.equal(boundedQuestionPoints(3.01), 3)
  assert.equal(boundedQuestionPoints(3.8), 4)
})
