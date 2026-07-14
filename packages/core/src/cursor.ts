// Unified "load more" cursor (v1). Providers fetch an overfetched pool per page
// (fetchLimit ≥ limit) while each call returns only `limit`, and RRF fusion makes
// raw provider pages overlap — so the cursor carries the CURRENT provider-local
// page plus compact hashes of every already-returned result. The client filters
// repeats out and advances the page internally only once a page's pool is
// exhausted. The string is an implementation detail — treat it as opaque; only
// `meta.nextCursor` from a previous search is a valid input.
import { z } from 'zod'
import { fnv1a } from './hash'
import { canonicalizeUrl } from './dedup-key'

export interface SearchCursorState {
  v: 1
  /** Provider-local page the current pool comes from (routed as controls.page;
   *  1-based). Advanced by the client, not per call. */
  page: number
  /** {@link cursorSeenKey} hashes of results returned on previous calls. Capped
   *  by the client (most recent kept) so cursor size stays bounded; a 32-bit
   *  hash keeps entries compact — the worst case of a collision or an evicted
   *  entry is one result suppressed or repeated. */
  seen: string[]
}

const cursorSchema = z.object({
  v: z.literal(1),
  page: z.number().int().min(1),
  seen: z.array(z.string()),
})

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
  const result = cursorSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error('refkit.search: invalid cursor (not produced by meta.nextCursor)')
  }
  return result.data
}
