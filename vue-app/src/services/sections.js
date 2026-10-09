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
  // Senior-high-style sections have no year digit at all (e.g. "STEM-A"),
  // so the branch above never applies to them -- without this, "STEM A"
  // and "STEM-A" canonicalize to two different strings (space kept vs.
  // hyphen kept) and show up as two separate sections everywhere. Must
  // stay in lockstep with app/sections.py's canonical_section().
  const suffixMatch = text.match(/^(.+?)\s*[- ]\s*([A-Z])$/)
  if (suffixMatch) {
    const program = suffixMatch[1].replace(/\s+/g, ' ').trim()
    const compact = program.replace(/[^A-Z0-9]/g, '')
    return `${compact === 'BSINFOTECH' ? 'BS INFOTECH' : program}-${suffixMatch[2]}`
  }
  return text.replace(/\s*-\s*/g, '-')
}
