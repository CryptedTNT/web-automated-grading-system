import test from 'node:test'
import assert from 'node:assert/strict'
import { batchProgress, progressToken } from '../src/services/gradingProgress.js'

test('percentage advances within the current submission', () => {
  assert.equal(batchProgress(2, 10, 0), 20)
  assert.equal(batchProgress(2, 10, 0.5), 25)
  assert.equal(batchProgress(2, 10, 0.95), 29.5)
  assert.equal(batchProgress(0, 1, 0.5), 50)
})

test('final session completion is reserved and values are bounded', () => {
  assert.equal(batchProgress(9, 10, 1), 99.9)
  assert.equal(batchProgress(0, 0, 1), 0)
  assert.equal(batchProgress(0, 1, -1), 0)
  assert.match(progressToken(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
})
