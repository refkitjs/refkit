// Unified "load more" cursor (v1). RRF fusion means provider page N+1 overlaps
// page N, so raw `controls.page` pushes cross-page dedup onto every caller. The
// cursor internalizes that: it carries the next provider-local page plus compact
// hashes of every already-returned result, and the client filters repeats out
// before applying `limit`. The string is an implementation detail — treat it as
// opaque; only `meta.nextCursor` from a previous search is a valid input.
import { fnv1a } from './hash'
import { canonicalizeUrl } from './dedup-key'

export interface SearchCursorState {
  v: 1
  /** Provider-local page to request next (routed as controls.page; 1-based). */
  page: number
  /** {@link cursorSeenKey} hashes of results returned on previous pages. Grows
   *  linearly with pages consumed — a 32-bit hash keeps entries compact; the
   *  worst case of a collision is one new result suppressed as already-seen. */
  seen: string[]
}

/** Compact already-seen key for a result — same URL canonicalization as merge/dedup. */
export function cursorSeenKey(canonicalUrl: string): string {
  return fnv1a(canonicalizeUrl(canonicalUrl))
}

export function encodeCursor(state: SearchCursorState): string {
  return JSON.stringify(state)
}

/** Parse and validate a cursor string. Throws on anything that is not a cursor
 *  this library produced — a corrupted cursor must fail loudly, not quietly
 *  restart from page 1. */
export function decodeCursor(cursor: string): SearchCursorState {
  let parsed: unknown
  try {
    parsed = JSON.parse(cursor)
  } catch {
    throw new Error('refkit.search: invalid cursor (not produced by meta.nextCursor)')
  }
  const s = parsed as Partial<SearchCursorState> | null
  if (
    !s || typeof s !== 'object' || s.v !== 1
    || typeof s.page !== 'number' || !Number.isInteger(s.page) || s.page < 1
    || !Array.isArray(s.seen) || !s.seen.every(k => typeof k === 'string')
  ) {
    throw new Error('refkit.search: invalid cursor (not produced by meta.nextCursor)')
  }
  return { v: 1, page: s.page, seen: s.seen }
}
