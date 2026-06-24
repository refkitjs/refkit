import { describe, expect, it } from 'vitest'
import { mergeReferences } from '../merge'
import type { Reference } from '../reference'

const make = (id: string, url: string, hash?: string): Reference => ({
  id,
  modality: 'image',
  source: { providerId: id.split('-')[0], sourceUrl: url },
  canonicalUrl: url,
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
  verifiedAt: '2026-06-22T00:00:00.000Z',
  relevance: 0,
  perceptualHash: hash,
})

describe('mergeReferences (RRF)', () => {
  it('returns a single ranked list with relevance in 0..1, top item = 1', () => {
    const out = mergeReferences([
      [make('a-1', 'https://a/1'), make('a-2', 'https://a/2')],
      [make('b-1', 'https://b/1')],
    ])
    expect(out.length).toBe(3)
    expect(out[0].relevance).toBe(1)
    for (const r of out) expect(r.relevance).toBeGreaterThan(0)
  })

  it('an item ranked highly in two sources beats items ranked once', () => {
    // same canonicalUrl appears top in both lists -> should rank first
    const out = mergeReferences([
      [make('a-1', 'https://shared/1'), make('a-2', 'https://a/2')],
      [make('b-1', 'https://shared/1'), make('b-2', 'https://b/2')],
    ])
    expect(out[0].canonicalUrl).toBe('https://shared/1')
  })

  it('dedupes after fusion', () => {
    const out = mergeReferences([
      [make('a-1', 'https://shared/1')],
      [make('b-1', 'https://shared/1')],
    ])
    expect(out).toHaveLength(1)
  })

  it('returns [] for empty / all-empty input without throwing', () => {
    expect(mergeReferences([])).toEqual([])
    expect(mergeReferences([[], []])).toEqual([])
  })

  it('handles a large pool without a Math.max(...spread) stack overflow', () => {
    // The fused-score max must not be computed via `Math.max(...scores)`: spreading
    // ~10^5 args overflows the call stack (RangeError). Pool size here is well past
    // that threshold so a regression to the spread form fails loudly.
    const big = Array.from({ length: 200_000 }, (_, i) => make(`p-${i}`, `https://p/${i}`))
    const out = mergeReferences([big])
    expect(out).toHaveLength(200_000)
    expect(out[0].relevance).toBe(1) // top still normalised to exactly 1.0
  })
})
