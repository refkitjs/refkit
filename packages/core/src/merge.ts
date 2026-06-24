import type { Reference } from './reference'
import { canonicalizeUrl } from './dedup-key'
import { dedupeReferences, type DedupeOptions } from './dedup'

export interface MergeOptions extends DedupeOptions {
  /** RRF dampening constant. Standard default 60. */
  k?: number
}

// Reciprocal Rank Fusion across per-source ranked lists. Each list is assumed already
// ordered best-first by its source. The same item (by canonical URL) appearing across
// lists accumulates score, so cross-source agreement floats to the top — without
// needing comparable absolute scores. Output relevance is max-normalized to 0..1.
export function mergeReferences(perSource: Reference[][], opts: MergeOptions = {}): Reference[] {
  const k = opts.k ?? 60
  const score = new Map<string, number>() // dedup key -> accumulated RRF score
  const rep = new Map<string, Reference>() // dedup key -> best representative

  for (const list of perSource) {
    list.forEach((ref, rank) => {
      const key = canonicalizeUrl(ref.canonicalUrl)
      score.set(key, (score.get(key) ?? 0) + 1 / (k + rank))
      const cur = rep.get(key)
      if (!cur || ref.relevance > cur.relevance) rep.set(key, ref)
    })
  }

  // Normalize by the actual max so the top result's relevance is exactly 1.0.
  // Reduce, not Math.max(...score.values()) — the merged pool can be large and a
  // spread of that many args overflows the call stack. RRF scores are fractional
  // (1/(k+rank) sums), so we keep the true max (no floor) to hit exactly 1.0. For
  // empty input score has no entries, so the .map body never runs and the seed
  // maxScore (-Infinity) is never used in the division.
  let maxScore = -Infinity
  for (const s of score.values()) if (s > maxScore) maxScore = s
  const fused: Reference[] = [...score.entries()]
    .map(([key, s]) => ({ ...rep.get(key)!, relevance: s / maxScore }))
    .sort((a, b) => b.relevance - a.relevance)

  // Perceptual-hash dedup as a second pass (URL dedup already happened via the key map).
  return dedupeReferences(fused, opts)
}
