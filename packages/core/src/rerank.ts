import type { Reference } from './reference'
import { permissivenessScore } from './license'
import { factsOf } from './rights'

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

/** All ranking text a ref carries: title, description, tags, text excerpt. */
export function refText(ref: Pick<Reference, 'title' | 'description' | 'tags' | 'text'>): string {
  return [ref.title, ref.description, ...(ref.tags ?? []), ref.text?.excerpt].filter(Boolean).join(' ')
}

/** Tuning weights for {@link lexicalReranker}. All weights are clamped to ≥ 0. */
export interface LexicalRerankOptions {
  /** Weight of the query↔ranking-text term-coverage score. Default 1. */
  lexicalWeight?: number
  /** Weight of the INCOMING fused `relevance` — max-normalised RRF, which already
   *  carries cross-source agreement and the per-source confidence weights. Default
   *  0.5, so an equal lexical hit from a source that mostly answered the query
   *  outranks the same hit from one that mostly didn't. 0 restores pure lexical
   *  ordering and makes source confidence a tie-break plus a diagnostic. */
  fusionWeight?: number
  /** Weight of the resolution quality boost (0 disables). Default 0.15. */
  qualityWeight?: number
  /** Weight of the license-permissiveness boost (0 disables). Default 0. */
  licenseWeight?: number
  /** Per-already-seen-source score penalty, spreading sources (0 disables). Default 0.1. */
  sourceDiversity?: number
  /** Penalty for a candidate whose title nearly repeats one already picked FROM
   *  THE SAME SOURCE — an upload batch ("… 1", "… 2", "… 3") otherwise fills the
   *  top with one subject (0 disables). Default 0.25. */
  nearDuplicatePenalty?: number
  /** Title-token Jaccard at or above which two same-source titles count as near
   *  duplicates. Default 0.7; values outside 0…1 fall back to the default — to
   *  disable the penalty set `nearDuplicatePenalty: 0`, not a threshold of 0. */
  nearDuplicateThreshold?: number
  /** Weight of the source's own upstream score, min-max normalised WITHIN each
   *  source (0 disables). Default 0 — upstream scales are not comparable across
   *  sources, so this only ever breaks ties inside one source's results. */
  sourceScoreWeight?: number
}

/** Fraction of distinct query tokens present in the ref's ranking text. 0..1. */
function lexicalScore(queryTokens: string[], ref: Reference): number {
  if (queryTokens.length === 0) return 0
  const hay = new Set(tokenize(refText(ref)))
  let hit = 0
  for (const q of queryTokens) if (hay.has(q)) hit++
  return hit / queryTokens.length
}

/** Token-set overlap ratio. Two EMPTY sets score 0, not 1: untitled refs (and
 *  titles that tokenize to nothing) carry no evidence that they are the same
 *  upload batch, and calling them duplicates penalised every one after the first.
 *  The early return also keeps the 0/0 division from happening. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
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

/** Upstream `sourceScore` min-max normalised WITHIN each source — the scales are
 *  source-local, so comparing them across sources would be meaningless. 0.5 when
 *  a ref carries no score, or when its source offers a single value (nothing to
 *  rank against, so neither rewarded nor punished). */
function sourceScoreScores(refs: readonly Reference[]): number[] {
  const span = new Map<string, { min: number; max: number }>()
  const scoreOf = (r: Reference) => (typeof r.sourceScore === 'number' && Number.isFinite(r.sourceScore) ? r.sourceScore : undefined)
  for (const r of refs) {
    const s = scoreOf(r)
    if (s === undefined) continue
    const cur = span.get(r.source.providerId)
    if (!cur) span.set(r.source.providerId, { min: s, max: s })
    else {
      if (s < cur.min) cur.min = s
      if (s > cur.max) cur.max = s
    }
  }
  return refs.map((r) => {
    const s = scoreOf(r)
    if (s === undefined) return 0.5
    const { min, max } = span.get(r.source.providerId)!
    return max > min ? (s - min) / (max - min) : 0.5
  })
}

/**
 * Zero-dependency default reranker. Scores each ref by a weighted blend of query
 * term-coverage (over title + description + tags + excerpt), the INCOMING fused
 * relevance (so cross-source agreement and source confidence survive the rerank
 * instead of being overwritten by a pure lexical score), resolution quality,
 * license permissiveness and the source's own score, then greedily emits results
 * with a small per-source diversity penalty (MMR-lite) plus a same-source
 * near-duplicate-title penalty, so neither one provider nor one upload batch can
 * dominate the top. `relevance` is rewritten to the normalised blended score —
 * the greedy penalties steer the ORDER only, never the reported score.
 * Model-based reranking is the host's job via the hook.
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
  const fusW = w(opts.fusionWeight, 0.5)
  const qualW = w(opts.qualityWeight, 0.15)
  const licW = w(opts.licenseWeight, 0)
  const divW = w(opts.sourceDiversity, 0.1)
  const dupW = w(opts.nearDuplicatePenalty, 0.25)
  const ssW = w(opts.sourceScoreWeight, 0)
  // A Jaccard threshold outside 0…1 is meaningless (0 would call every pair of
  // titles duplicates), so it falls back to the default instead of inverting intent.
  const rawDupT = opts.nearDuplicateThreshold
  const dupT = typeof rawDupT === 'number' && Number.isFinite(rawDupT) && rawDupT > 0 && rawDupT <= 1 ? rawDupT : 0.7
  const total = lexW + fusW + qualW + licW + ssW || 1

  return ({ query, refs }) => {
    const qTokens = [...new Set(tokenize(query))]
    const qual = qualityScores(refs)
    const upstream = sourceScoreScores(refs)
    const scored = refs.map((ref, i) => ({
      ref,
      sid: ref.source.providerId,
      titleTokens: new Set(tokenize(ref.title ?? '')),
      // Set once a title already picked from this source turns out to repeat this
      // one; never cleared, since the picked set only grows.
      nearDup: false,
      base:
        lexW * lexicalScore(qTokens, ref) +
        // The merge writes a max-normalised 0..1 relevance here; the Math.min(1, …)
        // below caps the emitted blend either way.
        fusW * ref.relevance +
        qualW * qual[i] +
        licW * permissivenessScore(factsOf(ref.rights)) +
        ssW * upstream[i],
    }))

    // Greedy MMR-lite: repeatedly take the best (base − diversity penalty for an
    // already-picked source − near-duplicate penalty against that source's
    // already-picked titles) so neither sources nor one upload batch cluster.
    const remaining = scored.slice()
    const seen = new Map<string, number>()
    const out: Reference[] = []
    while (remaining.length > 0) {
      let bestIdx = 0
      let bestAdj = -Infinity
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i]
        const adj = cand.base - divW * (seen.get(cand.sid) ?? 0) - (cand.nearDup ? dupW : 0)
        if (adj > bestAdj) {
          bestAdj = adj
          bestIdx = i
        }
      }
      const [pick] = remaining.splice(bestIdx, 1)
      seen.set(pick.sid, (seen.get(pick.sid) ?? 0) + 1)
      // Flag the pick's near-duplicates once, here, instead of re-comparing every
      // candidate against every picked title on every round: the flag is sticky,
      // so the whole loop stays O(n²) like the plain diversity pass.
      if (dupW > 0) {
        for (const cand of remaining) {
          if (cand.nearDup || cand.sid !== pick.sid) continue
          if (jaccard(cand.titleTokens, pick.titleTokens) >= dupT) cand.nearDup = true
        }
      }
      out.push({ ...pick.ref, relevance: Math.min(1, pick.base / total) })
    }
    return out
  }
}
