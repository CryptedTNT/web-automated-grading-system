/* ============================================================
   duration.js — a formal, human-readable span of time, for the
   "grading finished" summary (stores/processing.js). "2 minutes and
   14 seconds", not "134s" or a raw millisecond count.
   ============================================================ */

function unit(value, singular) {
  return `${value} ${singular}${value === 1 ? '' : 's'}`
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts = []
  if (hours) parts.push(unit(hours, 'hour'))
  if (minutes) parts.push(unit(minutes, 'minute'))
  // Always show seconds, even "0 seconds", unless a larger unit already
  // said something -- "3 minutes" alone reads fine, "0 seconds" alone
  // for an instant run does too, but "3 minutes, 0 seconds" is noise.
  if (seconds || parts.length === 0) parts.push(unit(seconds, 'second'))

  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}
