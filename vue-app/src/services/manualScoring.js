export function validManualScore(value, maximum) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return false
  const score = Number(text)
  return Number.isFinite(score) && score >= 0 && score <= Number(maximum)
}
