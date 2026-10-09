import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration } from '../src/services/duration.js'

test('sub-minute runs show only seconds', () => {
  assert.equal(formatDuration(0), '0 seconds')
  assert.equal(formatDuration(1000), '1 second')
  assert.equal(formatDuration(45000), '45 seconds')
})

test('minutes and seconds join with "and"', () => {
  assert.equal(formatDuration(134000), '2 minutes and 14 seconds')
  assert.equal(formatDuration(60000), '1 minute')
  assert.equal(formatDuration(61000), '1 minute and 1 second')
})

test('hours join all three parts with an Oxford comma', () => {
  assert.equal(formatDuration(3723000), '1 hour, 2 minutes, and 3 seconds')
  assert.equal(formatDuration(3600000), '1 hour')
  assert.equal(formatDuration(7200000), '2 hours')
})

test('rounds to the nearest second and never goes negative', () => {
  assert.equal(formatDuration(1499), '1 second')
  assert.equal(formatDuration(1500), '2 seconds')
  assert.equal(formatDuration(-5000), '0 seconds')
  assert.equal(formatDuration(undefined), '0 seconds')
})
