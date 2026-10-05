/** Actual submission work fraction within overall batch completion. */
export function batchProgress(completed, total, fraction) {
  if (!(total > 0)) return 0
  const work = Math.min(1, Math.max(0, Number(fraction) || 0))
  // Reserve 100% for successful final session commit.
  return Math.min(99.9, Math.round(((completed + work) / total) * 1000) / 10)
}

export function progressToken() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
