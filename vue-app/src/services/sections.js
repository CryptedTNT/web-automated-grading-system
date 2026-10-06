// Shared section identity for directory filters and scoped exports.
export function canonicalSection(value) {
  const text = String(value || '').trim().toUpperCase()
    .replace(/[\u2013\u2014_]/g, '-').replace(/\s+/g, ' ')
  if (!text) return ''
  const match = text.match(/^(.+?)\s*(\d+)\s*[- ]?\s*([A-Z])$/)
  if (match) {
    const program = match[1].replace(/\s+/g, ' ').trim()
    const compact = program.replace(/[^A-Z0-9]/g, '')
    return `${compact === 'BSINFOTECH' ? 'BS INFOTECH' : program} ${match[2]}-${match[3]}`
  }
  return text.replace(/\s*-\s*/g, '-')
}
