// FNV-1a 32-bit. Deterministic, dependency-free, runtime-agnostic.
// Used only for content-addressed ids / dedup keys — not for security.

/** Raw uint32 FNV-1a — for callers that pack the hash into binary (cursor). */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Base36 rendering of {@link fnv1a32} — for string ids / dedup keys. */
export function fnv1a(str: string): string {
  return fnv1a32(str).toString(36)
}
