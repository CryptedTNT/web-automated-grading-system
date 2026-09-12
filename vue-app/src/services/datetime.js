/* ============================================================
   services/datetime.js — formats backend timestamps for display

   The backend returns naive UTC timestamps (see backend's
   datetime.datetime.utcnow() calls) with no timezone marker at all,
   e.g. "2026-09-12T18:34:50". Handed straight to `new Date(...)`, a
   marker-less date-time string is parsed as the VIEWER'S OWN LOCAL
   time, not UTC -- for a Philippine viewer that would silently read a
   UTC timestamp 8 hours off from the real Philippine time, not just
   display it oddly. Appending "Z" first forces it to be read as the
   UTC instant it actually is; timeZone: 'Asia/Manila' below then makes
   the displayed time always Philippine time regardless of whatever
   timezone the viewer's own browser/OS happens to be set to.
   ============================================================ */

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatDateTime(value) {
  if (!value) return ''
  const hasTimezone = /[Zz]|[+-]\d\d:\d\d$/.test(value)
  const date = new Date(hasTimezone ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  return formatter.format(date)
}
