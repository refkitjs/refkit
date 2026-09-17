import { describe, expect, it } from 'vitest'
import { lexicalHit, sourceConfidence } from '../confidence'
import { tokenize } from '../rerank'
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

describe('sourceConfidence', () => {
  it('floors at 0.1 and rises with the hit rate', () => {
    const q = tokenize('lion')
    expect(sourceConfidence(q, [ref('a', 'Nail art'), ref('b', 'Gel nails')])).toBeCloseTo(0.1, 5)
    expect(sourceConfidence(q, [ref('a', 'Lion head'), ref('b', 'Gel nails')])).toBeCloseTo(0.55, 5)
    expect(sourceConfidence(q, [])).toBe(1)
  })

  it('trusts a source fully when the query tokenizes to nothing', () => {
    // A 1-char query has no tokens to look for — absence of a hit is not evidence.
    expect(sourceConfidence(tokenize('x'), [ref('a', 'Nail art')])).toBe(1)
  })

  it('clamps a nonsense floor so a weight stays a trust value', () => {
    const q = tokenize('lion')
    const miss = [ref('a', 'Nail art')]
    expect(sourceConfidence(q, miss, NaN)).toBeCloseTo(0.1, 5) // non-finite → default floor
    expect(sourceConfidence(q, miss, 5)).toBe(1)
    expect(sourceConfidence(q, miss, -2)).toBe(0)
  })
})

describe('lexicalHit', () => {
  it('counts a hit anywhere in the ranking text, not just the title', () => {
    const q = tokenize('lion')
    expect(lexicalHit(q, ref('a', 'Untitled', { tags: ['lion', 'cub'] }))).toBe(true)
    expect(lexicalHit(q, ref('b', 'Untitled', { description: 'a sleeping lion' }))).toBe(true)
    expect(lexicalHit(q, ref('c', 'Untitled', { text: { excerpt: 'the lion sleeps', excerptKind: 'passage' } }))).toBe(true)
    expect(lexicalHit(q, ref('d', 'Untitled'))).toBe(false)
  })

  it('never hits on an empty query', () => {
    expect(lexicalHit([], ref('a', 'Lion head'))).toBe(false)
  })
})

describe('public surface', () => {
  it('exports sourceConfidence and lexicalHit from the package root', () => {
    expect(typeof refkit.sourceConfidence).toBe('function')
    expect(typeof refkit.lexicalHit).toBe('function')
  })
})
