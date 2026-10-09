import test from 'node:test'
import assert from 'node:assert/strict'
import {
  displayGrade, gradeHeader, gradeSuffix, normalizeGradingScale, parseGradingScale, formatGradingScale,
} from '../src/services/gradingScale.js'

test('percentage scale leaves the stored percentage unchanged', () => {
  assert.equal(displayGrade(80, 'percentage'), 80)
  assert.equal(displayGrade(33.33, 'percentage'), 33.33)
  assert.equal(gradeSuffix('percentage'), '%')
  assert.equal(gradeHeader('percentage'), '% Score')
})

test('base 50 is (score / total) * 50 + 50', () => {
  assert.equal(displayGrade(0, 'base50'), 50)
  assert.equal(displayGrade(100, 'base50'), 100)
  assert.equal(displayGrade(80, 'base50'), 90)
  assert.equal(displayGrade(50, 'base50'), 75)
  assert.equal(gradeSuffix('base50'), '')
  assert.equal(gradeHeader('base50'), 'Grade')
})

test('averaging then converting equals converting then averaging', () => {
  const percentages = [40, 65, 90]
  const mean = percentages.reduce((sum, p) => sum + p, 0) / percentages.length
  const averageOfGrades = percentages.reduce((sum, p) => sum + displayGrade(p, 'base50'), 0) / percentages.length
  assert.ok(Math.abs(displayGrade(mean, 'base50') - averageOfGrades) < 0.01)
})

test('unknown or missing scale falls back to percentage, and bad values show as zero', () => {
  assert.equal(normalizeGradingScale(undefined), 'percentage')
  assert.equal(normalizeGradingScale('raw'), 'percentage')
  assert.equal(displayGrade('not a number', 'base50'), 0)
  assert.equal(displayGrade(null, 'percentage'), 0)
})

test('manual base score is (score / total) * (100 - base) + base, for a teacher-chosen base', () => {
  assert.equal(displayGrade(0, 'custom:60'), 60)
  assert.equal(displayGrade(100, 'custom:60'), 100)
  assert.equal(displayGrade(50, 'custom:60'), 80) // halfway between 60 and 100
  assert.equal(gradeSuffix('custom:60'), '')
  assert.equal(gradeHeader('custom:60'), 'Grade')
  // base 50 is the custom formula's special case -- same numbers either way
  assert.equal(displayGrade(80, 'custom:50'), displayGrade(80, 'base50'))
})

test('parseGradingScale/formatGradingScale round-trip, and reject an out-of-range base', () => {
  assert.deepEqual(parseGradingScale('custom:60'), { mode: 'custom', base: 60 })
  assert.equal(formatGradingScale('custom', 60), 'custom:60')
  assert.equal(formatGradingScale('custom', '60'), 'custom:60') // the <input type=number> binding can hand back a string
  assert.equal(formatGradingScale('custom', 150), 'custom:99') // clamped, since 100 would divide by zero in the formula
  assert.equal(formatGradingScale('custom', -5), 'custom:0')
  // malformed/out-of-range stored values (100 would divide by zero; non-numeric never should have been saved) fall back
  assert.equal(normalizeGradingScale('custom:100'), 'percentage')
  assert.equal(normalizeGradingScale('custom:abc'), 'percentage')
})
