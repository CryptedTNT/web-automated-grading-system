/* Grade shown to the teacher, computed from the stored percentage
   (score / total points * 100). Base 50 (LSPU) is (score / total) * 50 + 50,
   which is percentage / 2 + 50. Manual Base generalizes that to a
   teacher-chosen base instead of a fixed 50: (score / total) * (100 - base)
   + base, so a zero score becomes that base and a perfect score is still
   100. All three are linear in the stored percentage, so an average taken
   over stored percentages and then converted equals the average of the
   converted grades.

   The chosen scale is still persisted as a single opaque string (as
   `store.gradingScale`, `settings.grading_scale`, export preferences, ...),
   so every existing call site that only ever forwards that string needs no
   change -- "custom:60" is just another valid value alongside "percentage"
   and "base50". Only this file and the Settings page that edits it need to
   know the encoding. */

export const GRADING_SCALES = [
  {
    value: 'percentage',
    label: 'Percentage',
    detail: 'Score ÷ total points × 100. This is the default.',
  },
  {
    value: 'base50',
    label: 'Base 50 (LSPU)',
    detail: '(Score ÷ total points) × 50 + 50. A score of zero is 50 and a perfect score is 100.',
  },
]

const CUSTOM_PREFIX = 'custom:'

/* Decodes a stored grading_scale value into { mode, base }. `base` is only
   meaningful when mode === 'custom'; it is null otherwise. Anything
   unrecognized (including no setting saved yet) falls back to 'percentage'. */
export function parseGradingScale(value) {
  if (value === 'base50') return { mode: 'base50', base: null }
  if (typeof value === 'string' && value.startsWith(CUSTOM_PREFIX)) {
    const base = Number(value.slice(CUSTOM_PREFIX.length))
    if (Number.isFinite(base) && base >= 0 && base < 100) return { mode: 'custom', base }
  }
  return { mode: 'percentage', base: null }
}

/* Encodes { mode, base } back into the string that gets persisted. `base`
   is clamped to [0, 99] -- 100 would make every score read as 100 and
   divide by zero in the formula's (100 - base) factor. */
export function formatGradingScale(mode, base) {
  if (mode === 'base50') return 'base50'
  if (mode === 'custom') {
    const clamped = Math.min(99, Math.max(0, Math.round(Number(base))))
    return `${CUSTOM_PREFIX}${Number.isFinite(clamped) ? clamped : 60}`
  }
  return 'percentage'
}

export function normalizeGradingScale(value) {
  const { mode, base } = parseGradingScale(value)
  return formatGradingScale(mode, base)
}

export function displayGrade(percentage, scale) {
  const value = Number(percentage)
  if (!Number.isFinite(value)) return 0
  const { mode, base } = parseGradingScale(scale)
  const round2 = (n) => Math.round(n * 100) / 100
  if (mode === 'base50') return round2(value / 2 + 50)
  if (mode === 'custom') return round2((value / 100) * (100 - base) + base)
  return round2(value)
}

export function gradeSuffix(scale) {
  return parseGradingScale(scale).mode === 'percentage' ? '%' : ''
}

export function gradeHeader(scale) {
  return parseGradingScale(scale).mode === 'percentage' ? '% Score' : 'Grade'
}
