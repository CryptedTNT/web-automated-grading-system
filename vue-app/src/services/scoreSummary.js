/** Sum final earned points, not match percentages, for each question type. */
export function scoreByType(items) {
  const groups = new Map()
  const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
  for (const item of items) {
    const type = item.type || 'Other'
    if (!groups.has(type)) groups.set(type, { type, earned: 0, total: 0, count: 0, flagged: 0 })
    const group = groups.get(type)
    group.earned += numeric(item.earned)
    group.total += numeric(item.points)
    group.count += 1
    if (item.status === 'flagged') group.flagged += 1
  }
  return [...groups.values()].map((group) => ({
    ...group,
    earned: Math.round(group.earned * 10000) / 10000,
    total: Math.round(group.total * 10000) / 10000,
  }))
}
