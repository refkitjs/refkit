import { describe, expect, it } from 'vitest'
import { tokenize, lexicalReranker } from '../rerank'
import type { Reference } from '../reference'
import * as refkit from '../index'

const ref = (id: string, title: string, opts: Partial<Reference> = {}): Reference => ({
  id,
  modality: 'image',
  title,
  source: { providerId: 'p', sourceUrl: `https://x/${id}` },
  canonicalUrl: `https://x/${id}`,
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } },
  verifiedAt: '2026-06-24T00:00:00.000Z',
  relevance: 0,
  ...opts,
})

describe('lexicalReranker', () => {
  it('ranks a title that matches the query above one that does not', async () => {
    const refs = [
      ref('a', 'Interior of the National Gallery'),
      ref('b', 'Cyberpunk neon city at night'),
    ]
    const out = await lexicalReranker()({ query: 'cyberpunk neon city', refs })
    expect(out.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('returns a single ref unchanged and rewrites relevance to the normalised blend', async () => {
    const refs = [ref('a', 'cyberpunk city')]
    const out = await lexicalReranker()({ query: 'cyberpunk', refs })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
    // base = lexW·1 + qualW·0.5 (no visual) = 1 + 0.075 = 1.075; total = 1 + 0.15 = 1.15.
    // Pins the denominator + blend so a wrong divisor can't hide behind ordering.
    expect(out[0].relevance).toBeCloseTo(1.075 / 1.15, 5)
  })

  it('keeps input order and zeroes relevance when nothing matches (lexical-only)', async () => {
    const refs = [ref('a', 'red lion'), ref('b', 'blue whale')]
    const out = await lexicalReranker({ qualityWeight: 0, sourceDiversity: 0 })({ query: 'cyberpunk neon', refs })
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
    expect(out.every((r) => r.relevance === 0)).toBe(true)
  })

  it('breaks a lexical tie by resolution when qualityWeight > 0', async () => {
    const refs = [
      ref('low', 'red lion', { visual: { width: 100, height: 100 } }),
      ref('high', 'red lion', { visual: { width: 4000, height: 3000 } }),
    ]
    const out = await lexicalReranker()({ query: 'red lion', refs })
    expect(out[0].id).toBe('high')
  })

  it('spreads sources via MMR-lite instead of clustering one provider', async () => {
    // 3 from "a", 1 from "b", all equal lexical score → default diversity must
    // interleave "b" before the third "a".
    const refs = [
      ref('a1', 'lion', { source: { providerId: 'a', sourceUrl: 'https://x/a1' } }),
      ref('a2', 'lion', { source: { providerId: 'a', sourceUrl: 'https://x/a2' } }),
      ref('a3', 'lion', { source: { providerId: 'a', sourceUrl: 'https://x/a3' } }),
      ref('b1', 'lion', { source: { providerId: 'b', sourceUrl: 'https://x/b1' } }),
    ]
    const out = await lexicalReranker()({ query: 'lion', refs })
    const sources = out.map((r) => r.source.providerId)
    expect(sources.slice(0, 2)).toEqual(['a', 'b']) // b promoted above the 2nd+ a
  })

  it('prefers a more permissive license on a tie when licenseWeight > 0', async () => {
    const refs = [
      ref('prop', 'lion', { rights: { license: 'proprietary', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } } }),
      ref('cc0', 'lion', { rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } } }),
    ]
    const out = await lexicalReranker({ licenseWeight: 0.5, sourceDiversity: 0 })({ query: 'lion', refs })
    expect(out[0].id).toBe('cc0')
  })

  it('license boost is derived from facts: CC0 outranks CC-BY outranks unknown', () => {
    const mk = (id: string, license: string): Reference => ({
      id, modality: 'image', title: 'same', source: { providerId: 'p', sourceUrl: `https://x.test/${id}` }, canonicalUrl: `https://x.test/${id}`,
      rights: { license, rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } }, verifiedAt: new Date().toISOString(), relevance: 0,
    })
    const out = lexicalReranker({ lexicalWeight: 0, qualityWeight: 0, licenseWeight: 1, sourceDiversity: 0 })({ query: 'same', refs: [mk('u', 'unknown'), mk('b', 'CC-BY'), mk('z', 'CC0-1.0')] }) as Reference[]
    expect(out.map(r => r.id)).toEqual(['z', 'b', 'u'])
  })

  it('a license granting nothing never outranks a real grant, and ties with its peers', async () => {
    const rights = (license: string) => ({ license, rehostPolicy: 'cache-allowed' as const, raw: { sourceTerms: 't', sourceUrl: 'u' } })
    const out = await lexicalReranker({ lexicalWeight: 0, qualityWeight: 0, licenseWeight: 1, sourceDiversity: 0 })({
      query: 'same',
      refs: [
        ref('ncnd', 'same', { rights: rights('CC-BY-NC-ND') }),
        ref('prop', 'same', { rights: rights('proprietary') }),
        ref('nc', 'same', { rights: rights('CC-BY-NC') }),
      ],
    })
    const rank = (id: string) => out.findIndex((r) => r.id === id)
    // CC-BY-NC-ND grants nothing, but neither does proprietary — the obligation
    // credit is grant-scaled, so proprietary cannot buy a rank with its absent
    // obligations, and both stay below the NC row that actually grants derivatives.
    expect(rank('nc')).toBeLessThan(rank('ncnd'))
    expect(rank('nc')).toBeLessThan(rank('prop'))
    expect(rank('ncnd')).toBeLessThanOrEqual(rank('prop'))
    expect(out[rank('ncnd')].relevance).toBe(out[rank('prop')].relevance)
  })

  it('matches query tokens in the text excerpt, not just the title', async () => {
    const refs = [
      ref('title-only', 'untitled'),
      ref('excerpt', 'untitled', { text: { excerpt: 'a quiet cyberpunk alley at dawn', excerptKind: 'passage' } }),
    ]
    const out = await lexicalReranker()({ query: 'cyberpunk alley', refs })
    expect(out[0].id).toBe('excerpt')
  })

  it('scores description and tags, not just the title', () => {
    const plain = ref('a', 'Untitled')
    const tagged = ref('b', 'Untitled', { tags: ['forest', 'path'] })
    const described = ref('c', 'Untitled', { description: 'A path through a forest' })
    const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, nearDuplicatePenalty: 0 })({
      query: 'forest path',
      refs: [plain, tagged, described],
    }) as Reference[]
    expect(out.map(r => r.id).slice(0, 2).sort()).toEqual(['b', 'c'])
    expect(out[2].id).toBe('a')
  })

  it('penalises same-source near-duplicate titles so they do not cluster', () => {
    // A Commons upload batch: three near-identical titles from one source, all
    // matching the query as well as the genuinely different fourth result.
    const wiki = (id: string, title: string) =>
      ref(id, title, { source: { providerId: 'wiki', sourceUrl: `https://x/${id}` } })
    const dupes = [
      'Forest path near Graigddu-isaf 1',
      'Forest path near Graigddu-isaf 2',
      'Forest path near Graigddu-isaf 3',
    ].map((t, i) => wiki(`d${i}`, t))
    const other = wiki('o', 'Forest path in Finland')
    const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0 })({
      query: 'forest path',
      refs: [...dupes, other],
    }) as Reference[]
    expect(out[1].id).toBe('o')
    // The penalty steers the pick order only; relevance stays the honest blend
    // (all four cover the query completely, lexical-only → 1).
    expect(out.every(r => r.relevance === 1)).toBe(true)
  })

  it("breaks a tie on the source's own score when sourceScoreWeight > 0", () => {
    const lo = ref('lo', 'red lion', { sourceScore: 1 })
    const hi = ref('hi', 'red lion', { sourceScore: 9 })
    const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, nearDuplicatePenalty: 0, sourceScoreWeight: 0.5 })({
      query: 'red lion',
      refs: [lo, hi],
    }) as Reference[]
    expect(out.map(r => r.id)).toEqual(['hi', 'lo'])
    // per-source min-max: hi → 1, lo → 0; total = lexW + ssW = 1.5
    expect(out[0].relevance).toBeCloseTo(1, 5)
    expect(out[1].relevance).toBeCloseTo(1 / 1.5, 5)
  })

  it('ignores sourceScore by default (upstream scales are not comparable)', () => {
    const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, nearDuplicatePenalty: 0 })({
      query: 'red lion',
      refs: [ref('lo', 'red lion', { sourceScore: 1 }), ref('hi', 'red lion', { sourceScore: 9 })],
    }) as Reference[]
    expect(out.map(r => r.id)).toEqual(['lo', 'hi'])
  })

  it('gives a source with a single scored ref the neutral 0.5, not 0', () => {
    const solo = ref('solo', 'red lion', { sourceScore: 3 })
    const out = lexicalReranker({ lexicalWeight: 0, qualityWeight: 0, sourceScoreWeight: 1 })({
      query: 'red lion',
      refs: [solo],
    }) as Reference[]
    expect(out[0].relevance).toBeCloseTo(0.5, 5)
  })

  it('stays tractable on a large single-source pool of near-duplicates', () => {
    // The near-duplicate flag must be computed once per pick (sticky), not
    // re-derived against every already-picked title on every round: the latter is
    // O(n³) and would blow the test timeout on a realistic overfetched pool.
    const refs = Array.from({ length: 1200 }, (_, i) =>
      ref(`r${i}`, `Forest path near Graigddu-isaf ${i}`, { source: { providerId: 'wiki', sourceUrl: `https://x/r${i}` } }))
    const out = lexicalReranker()({ query: 'forest path', refs }) as Reference[]
    expect(out).toHaveLength(1200)
    expect(new Set(out.map(r => r.id)).size).toBe(1200) // a reorder, not a resample
  })

  it('clamps negative weights to 0 (keeps relevance in 0..1, ordering sane)', async () => {
    const refs = [ref('a', 'red lion'), ref('b', 'blue whale')]
    const out = await lexicalReranker({ lexicalWeight: -1, qualityWeight: 0, sourceDiversity: 0 })({ query: 'red lion', refs })
    expect(out.every((r) => r.relevance >= 0 && r.relevance <= 1)).toBe(true)
    // lexW clamps to 0 → all bases 0 → stable input order, no inverted ranking.
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('treats a NaN weight as 0 instead of poisoning relevance with NaN', async () => {
    const refs = [ref('a', 'red lion'), ref('b', 'blue whale')]
    const out = await lexicalReranker({ lexicalWeight: NaN })({ query: 'red lion', refs })
    expect(out.every((r) => Number.isFinite(r.relevance) && r.relevance >= 0 && r.relevance <= 1)).toBe(true)
  })
})

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops stopwords and 1-char tokens', () => {
    expect(tokenize('A Cyberpunk Neon-City at Night!')).toEqual(['cyberpunk', 'neon', 'city', 'night'])
  })

  it('returns [] for empty / stopword-only input', () => {
    expect(tokenize('   the of a   ')).toEqual([])
    expect(tokenize('')).toEqual([])
  })

  it('tokenizes CJK runs into character bigrams (lone char stays a unigram)', () => {
    expect(tokenize('青花瓷')).toEqual(['青花', '花瓷'])
    expect(tokenize('瓷')).toEqual(['瓷'])
    expect(tokenize('Ming 青花瓷 vase')).toEqual(['ming', 'vase', '青花', '花瓷'])
  })

  it('lexicalReranker scores CJK queries against CJK titles', async () => {
    const rerank = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0 })
    const out = await rerank({
      query: '青花瓷',
      refs: [ref('miss', 'Roman marble bust'), ref('match', '明代青花瓷盘')],
    })
    expect(out.map((r) => r.id)).toEqual(['match', 'miss'])
    expect(out[0].relevance).toBeGreaterThan(out[1].relevance)
  })
})

describe('public surface', () => {
  it('exports lexicalReranker and tokenize from the package root', () => {
    expect(typeof refkit.lexicalReranker).toBe('function')
    expect(typeof refkit.tokenize).toBe('function')
    expect(typeof refkit.refText).toBe('function')
  })
})
