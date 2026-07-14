import type { Reference } from './reference'
import type { LicenseId } from './license'

/** The arguments a {@link Reranker} receives: the user query, the merged
 *  candidate refs (read-only — copy before reordering), and the search's
 *  abort signal. The `signal` is for BYO async/model rerankers; the bundled
 *  {@link lexicalReranker} is synchronous and ignores it. */
export interface RerankInput {
  query: string
  refs: readonly Reference[]
  signal?: AbortSignal
}

/** A post-merge reordering strategy, injected via `SearchInput.rerank`. Pure or
 *  async — e.g. a CLIP/embedding reranker the host wires to its own API. Core
 *  ships no model; this is the only seam.
 *
 *  Core does NOT re-validate the returned refs (provider output is parsed at the
 *  boundary, but a reranker's is trusted). A reranker MUST preserve the
 *  `referenceSchema` invariants — notably `relevance` in 0..1 — and treat the
 *  result as a reorder/subset: no dropped required fields, no dups or fabricated
 *  refs. The input refs (and their nested `rights`/`visual`/`text` objects) are
 *  the live merged set; reorder copies, never mutate them in place. */
export type Reranker = (input: RerankInput) => Reference[] | Promise<Reference[]>

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'with',
  'by', 'from', 'as', 'is', 'are', 'it', 'this', 'that',
])

// CJK scripts have no word boundaries to split on, so character bigrams are the
// standard zero-dependency indexing unit (Han incl. compatibility ideographs,
// kana, hangul — BMP ranges).
const CJK_RUNS = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+/g

/** Latin/digit runs: lowercase, split on non-alphanumerics, drop stopwords and
 *  1-char tokens. CJK runs: character bigrams (a lone char stays a unigram), so
 *  CJK queries score instead of tokenizing to nothing. */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const out = lower
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  for (const run of lower.match(CJK_RUNS) ?? []) {
    const chars = [...run]
    if (chars.length === 1) out.push(chars[0])
    else for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1])
  }
  return out
}

/** Tuning weights for {@link lexicalReranker}. All weights are clamped to ≥ 0. */
export interface LexicalRerankOptions {
  /** Weight of the query↔(title+excerpt) term-coverage score. Default 1. */
  lexicalWeight?: number
  /** Weight of the resolution quality boost (0 disables). Default 0.15. */
  qualityWeight?: number
  /** Weight of the license-permissiveness boost (0 disables). Default 0. */
  licenseWeight?: number
  /** Per-already-seen-source score penalty, spreading sources (0 disables). Default 0.1. */
  sourceDiversity?: number
}

/** Fraction of distinct query tokens present in the ref's title + text excerpt. 0..1. */
function lexicalScore(queryTokens: string[], ref: Reference): number {
  if (queryTokens.length === 0) return 0
  const hay = new Set(tokenize(`${ref.title ?? ''} ${ref.text?.excerpt ?? ''}`))
  let hit = 0
  for (const q of queryTokens) if (hay.has(q)) hit++
  return hit / queryTokens.length
}

const LICENSE_PERMISSIVENESS: Record<LicenseId, number> = {
  'CC0-1.0': 1, PD: 1,
  unsplash: 0.85, pexels: 0.85, pixabay: 0.85,
  'CC-BY': 0.75, 'CC-BY-SA': 0.65,
  'CC-BY-ND': 0.55, 'CC-BY-NC': 0.45, 'CC-BY-NC-SA': 0.4, 'CC-BY-NC-ND': 0.35,
  unknown: 0.3, proprietary: 0.2,
}

/** Resolution (w×h) as a quality proxy, normalised to the batch max → 0..1; 0.5 when
 *  unknown. Max-normalised, so one very large image compresses the rest — acceptable
 *  at the default qualityWeight of 0.15. */
function qualityScores(refs: readonly Reference[]): number[] {
  const px = refs.map((r) => (r.visual ? r.visual.width * r.visual.height : 0))
  // Reduce, not Math.max(...px) — the merged pool can be large and a spread of
  // that many args overflows the call stack. Floor at 1 keeps the division safe.
  let max = 1
  for (const p of px) if (p > max) max = p
  return px.map((p) => (p > 0 ? p / max : 0.5))
}

/**
 * Zero-dependency default reranker. Scores each ref by a weighted blend of query
 * term-coverage (over title + excerpt), resolution quality, and license
 * permissiveness, then greedily emits results with a small per-source diversity
 * penalty (MMR-lite) so one provider can't dominate the top. `relevance` is
 * rewritten to the normalised blended score. Model-based reranking is the host's
 * job via the hook.
 */
export function lexicalReranker(opts: LexicalRerankOptions = {}): Reranker {
  // Negative / non-finite weights are meaningless — they'd invert ranking or
  // poison the relevance normaliser (NaN, or a spurious relevance of 1) — so any
  // weight that isn't a positive finite number falls back to 0.
  const w = (n: number | undefined, fallback: number) => {
    const v = n ?? fallback
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  const lexW = w(opts.lexicalWeight, 1)
  const qualW = w(opts.qualityWeight, 0.15)
  const licW = w(opts.licenseWeight, 0)
  const divW = w(opts.sourceDiversity, 0.1)
  const total = lexW + qualW + licW || 1

  return ({ query, refs }) => {
    const qTokens = [...new Set(tokenize(query))]
    const qual = qualityScores(refs)
    const scored = refs.map((ref, i) => ({
      ref,
      base:
        lexW * lexicalScore(qTokens, ref) +
        qualW * qual[i] +
        licW * LICENSE_PERMISSIVENESS[ref.rights.license],
    }))

    // Greedy MMR-lite: repeatedly take the best (base − diversity penalty for an
    // already-picked source) so sources spread out instead of clustering.
    const remaining = scored.slice()
    const seen = new Map<string, number>()
    const out: Reference[] = []
    while (remaining.length > 0) {
      let bestIdx = 0
      let bestAdj = -Infinity
      for (let i = 0; i < remaining.length; i++) {
        const sid = remaining[i].ref.source.providerId
        const adj = remaining[i].base - divW * (seen.get(sid) ?? 0)
        if (adj > bestAdj) {
          bestAdj = adj
          bestIdx = i
        }
      }
      const [pick] = remaining.splice(bestIdx, 1)
      const sid = pick.ref.source.providerId
      seen.set(sid, (seen.get(sid) ?? 0) + 1)
      out.push({ ...pick.ref, relevance: Math.min(1, pick.base / total) })
    }
    return out
  }
}
