export function boundedQuestionPoints(value) {
  const points = Number(value)
  return Number.isFinite(points) ? Math.min(10, Math.max(1, Math.round(points))) : 1
}
