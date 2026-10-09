import test from 'node:test'
import assert from 'node:assert/strict'
import { matchEnumerationAnswers } from '../src/services/grading.js'

function item(item_no, correct_answer, { alternatives, points = 1, fuzzy_threshold = 85 } = {}) {
  return { item_no, correct_answer, alternatives, points, fuzzy_threshold }
}

test('a slash-joined answer is graded correct, not incorrect', () => {
  const result = matchEnumerationAnswers([item(1, 'Virtual Machines')], ['Virtual Machines / Cloud Platform'])
  assert.equal(result.perSlot[0].exact, true)
  assert.equal(result.perSlot[0].earned, 1)
})

test('a slash-joined answer also checks against declared alternatives', () => {
  const result = matchEnumerationAnswers(
    [item(1, 'Virtual Machines', { alternatives: 'Cloud Platform' })],
    ['Something Unrelated To This Key / Cloud Platform'],
  )
  assert.equal(result.perSlot[0].exact, true)
  assert.equal(result.perSlot[0].earned, 1)
})

test('an unrelated slash-joined answer is not silently credited', () => {
  const result = matchEnumerationAnswers([item(1, 'Virtual Machines')], ['Totally Unrelated / Also Unrelated'])
  assert.equal(result.perSlot[0].exact, false)
  assert.equal(result.perSlot[0].earned, 0)
})

test('a plain (non-slash) exact match is unaffected', () => {
  const result = matchEnumerationAnswers([item(1, 'Virtual Machines')], ['Virtual Machines'])
  assert.equal(result.perSlot[0].exact, true)
})
