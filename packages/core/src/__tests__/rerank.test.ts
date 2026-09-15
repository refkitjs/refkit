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
    const refs = [ref('a', 'cyberpunk city', { relevance: 0.4 })]
    const out = await lexicalReranker()({ query: 'cyberpunk', refs })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
    // base = lexW·1 + fusW·0.4 (the incoming fused relevance) + qualW·0.5 (no
    // visual) = 1 + 0.2 + 0.075 = 1.275; total = 1 + 0.5 + 0.15 = 1.65. Pins the
    // denominator + blend so a wrong divisor can't hide behind ordering.
    expect(out[0].relevance).toBeCloseTo(1.275 / 1.65, 5)
  })

  it('keeps input order and zeroes relevance when nothing matches (lexical-only)', async () => {
    const refs = [ref('a', 'red lion'), ref('b', 'blue whale')]
    // fusionWeight 0 explicitly: the fixture's incoming relevance is 0, so the
    // fusion term would vanish anyway — saying so keeps "lexical-only" honest.
    const out = await lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, fusionWeight: 0 })({ query: 'cyberpunk neon', refs })
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

  it('spreads sources under the shipped blend, fusion term live', async () => {
    // Hand-computed with every default in play (lexW 1, fusW 0.5, qualW 0.15,
    // divW 0.1, total 1.65): all four titles cover the query (lexical 1) and
    // carry no visual (quality 0.5 → +0.075), so base(a*) = 1 + 0.5·1.0 + 0.075
    // = 1.575 and base(b1) = 1 + 0.5·0.9 + 0.075 = 1.525. Once the first 'a' is
    // picked its siblings pay the 0.1 source penalty (→ 1.475), which costs them
    // more than the 0.05 fusion edge they hold over 'b1' — so the second source
    // still surfaces second. Titles differ per ref, so no near-duplicate penalty
    // is doing this work.
    const fromA = (id: string) =>
      ref(id, `lion ${id}`, { relevance: 1, source: { providerId: 'a', sourceUrl: `https://x/${id}` } })
    const b1 = ref('b1', 'lion cub', { relevance: 0.9, source: { providerId: 'b', sourceUrl: 'https://x/b1' } })
    const out = await lexicalReranker()({ query: 'lion', refs: [fromA('a1'), fromA('a2'), fromA('a3'), b1] })
    expect(out.map(r => r.id)).toEqual(['a1', 'b1', 'a2', 'a3'])
    expect(out.findIndex(r => r.source.providerId === 'b')).toBeLessThan(3)
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
    const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, fusionWeight: 0 })({
      query: 'forest path',
      refs: [...dupes, other],
    }) as Reference[]
    expect(out[1].id).toBe('o')
    // The penalty steers the pick order only; relevance stays the honest blend
    // (all four cover the query completely, lexical-only → 1).
    expect(out.every(r => r.relevance === 1)).toBe(true)
  })

  it('does not treat untitled refs as near-duplicates of each other', () => {
    // Jaccard over two EMPTY title-token sets is 0, not 1: "we cannot tell these
    // two apart" is not evidence that they are the same upload batch. With 1,
    // every untitled ref after the first from a source ate the penalty and lost
    // its place to a weaker-matching sibling. `u1`'s title tokenizes to nothing
    // (all stopwords), which is the same empty set by another route.
    const wiki = (id: string, opts: Partial<Reference>) =>
      ref(id, '', { source: { providerId: 'wiki', sourceUrl: `https://x/${id}` }, ...opts })
    const described = 'a forest path near the river bridge'
    const refs = [
      wiki('u0', { title: undefined, description: described }),
      wiki('u1', { title: 'the of a', description: described }),
      wiki('u2', { title: undefined, description: described }),
      // Covers the query 4/5 — below the untitled refs, but above a penalised one.
      wiki('t', { title: 'Forest path near river crossing' }),
    ]
    const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, fusionWeight: 0, nearDuplicatePenalty: 0.25 })({
      query: 'forest path near river bridge',
      refs,
    }) as Reference[]
    expect(out.map(r => r.id)).toEqual(['u0', 'u1', 'u2', 't'])
    expect(out.slice(0, 3).every(r => r.relevance === 1)).toBe(true)
  })

  it('carries the incoming fused relevance into the score via fusionWeight', () => {
    // Fusion already encodes cross-source agreement and source confidence; an
    // equal lexical hit must be broken by it, not discarded.
    const low = ref('low', 'red lion', { relevance: 0.3 })
    const high = ref('high', 'red lion', { relevance: 1 })
    const flat = { qualityWeight: 0, sourceDiversity: 0, nearDuplicatePenalty: 0 }
    const fused = lexicalReranker({ ...flat, fusionWeight: 1 })({ query: 'red lion', refs: [low, high] }) as Reference[]
    expect(fused.map(r => r.id)).toEqual(['high', 'low'])
    // total = lexW + fusW = 2; base(high) = 1 + 1, base(low) = 1 + 0.3.
    expect(fused[0].relevance).toBeCloseTo(1, 5)
    expect(fused[1].relevance).toBeCloseTo(1.3 / 2, 5)
    const ignored = lexicalReranker({ ...flat, fusionWeight: 0 })({ query: 'red lion', refs: [low, high] }) as Reference[]
    expect(ignored[0].relevance).toBe(ignored[1].relevance) // pure lexical: a real tie
  })

  it('nearDuplicateThreshold decides what counts as a repeat (0.8 pair penalised at the default, spared at 1)', () => {
    const wiki = (id: string, title: string) =>
      ref(id, title, { source: { providerId: 'wiki', sourceUrl: `https://x/${id}` } })
    // Title-token Jaccard against 'Forest path near river': exact1 → 1.0,
    // bridge → 4/5 = 0.8 (over the 0.7 default, under a raised 1), weak → 0.4.
    // Query coverage over 5 query tokens: 4/5 = 0.8 for the three 'Forest path
    // near river…' titles, 3/5 = 0.6 for weak — so only the 0.25 near-duplicate
    // penalty (0.8 → 0.55) can let weak overtake one of them.
    const refs = [
      wiki('exact0', 'Forest path near river'),
      wiki('exact1', 'Forest path near river'),
      wiki('bridge', 'Forest path near river bridge'),
      wiki('weak', 'Near river crossing'),
    ]
    const flat = { qualityWeight: 0, sourceDiversity: 0, fusionWeight: 0 }
    const query = 'forest path near river crossing'
    // Default 0.7: bridge repeats the picked exact0 closely enough to be
    // penalised, which drops it below weak.
    const atDefault = lexicalReranker(flat)({ query, refs }) as Reference[]
    expect(atDefault.map(r => r.id)).toEqual(['exact0', 'weak', 'exact1', 'bridge'])
    // Raised to 1: only the exact repeat is penalised, so bridge keeps its 0.8.
    const atOne = lexicalReranker({ ...flat, nearDuplicateThreshold: 1 })({ query, refs }) as Reference[]
    expect(atOne.map(r => r.id)).toEqual(['exact0', 'bridge', 'weak', 'exact1'])
  })

  it("breaks a tie on the source's own score when sourceScoreWeight > 0", () => {
    const lo = ref('lo', 'red lion', { sourceScore: 1 })
    const hi = ref('hi', 'red lion', { sourceScore: 9 })
    const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, nearDuplicatePenalty: 0, fusionWeight: 0, sourceScoreWeight: 0.5 })({
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
    const out = lexicalReranker({ lexicalWeight: 0, qualityWeight: 0, fusionWeight: 0, sourceScoreWeight: 1 })({
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
