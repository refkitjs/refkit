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

  it('matches query tokens in the text excerpt, not just the title', async () => {
    const refs = [
      ref('title-only', 'untitled'),
      ref('excerpt', 'untitled', { text: { excerpt: 'a quiet cyberpunk alley at dawn', excerptKind: 'passage' } }),
    ]
    const out = await lexicalReranker()({ query: 'cyberpunk alley', refs })
    expect(out[0].id).toBe('excerpt')
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
  })
})
