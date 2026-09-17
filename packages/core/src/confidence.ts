// Per-source trust for ONE query, computed from the batch a source returned —
// no model, no embeddings, the same tokenizer the lexical reranker uses. The
// merge multiplies each source's RRF contributions by it, so a source that
// answered something else (a Japanese nail-art index asked for "lion") stops
// out-ranking the sources that actually answered.
import type { Reference } from './reference'
import { refText, tokenize } from './rerank'

/** Default trust floor: the share of its RRF contribution a source keeps when
 *  nothing in its batch mentions the query. */
export const DEFAULT_CONFIDENCE_FLOOR = 0.1

/** Does any query token appear anywhere in the ref's ranking text? */
export function lexicalHit(queryTokens: readonly string[], ref: Pick<Reference, 'title' | 'description' | 'tags' | 'text'>): boolean {
  if (queryTokens.length === 0) return false
  const hay = new Set(tokenize(refText(ref)))
  return queryTokens.some((t) => hay.has(t))
}

/** How much to trust one source's batch for this query: the fraction of its refs
 *  whose text mentions any query token, floored so a source is dampened, never
 *  erased (non-English titles still get a foothold). 1 for an empty batch, and 1
 *  for a query that tokenizes to nothing — absence of a hit is only evidence
 *  when there was something to hit. */
export function sourceConfidence(
  queryTokens: readonly string[],
  refs: readonly Reference[],
  floor = DEFAULT_CONFIDENCE_FLOOR,
): number {
  if (refs.length === 0 || queryTokens.length === 0) return 1
  // A floor outside 0…1 would stop being a trust value (and NaN would poison
  // every weight), so clamp it here rather than at each call site.
  const f = Number.isFinite(floor) ? Math.min(1, Math.max(0, floor)) : DEFAULT_CONFIDENCE_FLOOR
  const hits = refs.filter((r) => lexicalHit(queryTokens, r)).length
  return f + (1 - f) * (hits / refs.length)
}
