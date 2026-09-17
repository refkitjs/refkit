import { describe, expect, it } from 'vitest'
import { completeReference, parseEmitted, parseReference, referenceSchema, type Reference } from '../reference'

const ref: Reference = {
  id: 'p:abc',
  modality: 'image',
  title: 'Sunset',
  source: { providerId: 'unsplash', sourceUrl: 'https://unsplash.com/photos/1' },
  canonicalUrl: 'https://unsplash.com/photos/1',
  rights: {
    license: 'unsplash',
    rehostPolicy: 'hotlink-required',
    raw: { sourceTerms: 'https://unsplash.com/license', sourceUrl: 'https://unsplash.com/photos/1' },
  },
  verifiedAt: '2026-06-22T00:00:00.000Z',
  relevance: 0.9,
}

describe('referenceSchema / parseReference', () => {
  it('accepts a fully-provenanced reference', () => {
    expect(parseReference(ref)).toEqual(ref)
    expect(referenceSchema.parse(ref)).toEqual(ref)
  })

  it('rejects a reference missing canonicalUrl (provenance required)', () => {
    const { canonicalUrl: _canonicalUrl, ...bad } = ref
    expect(() => parseReference(bad)).toThrow()
  })

  it('rejects a reference missing rights (provenance required)', () => {
    const { rights: _rights, ...bad } = ref
    expect(() => parseReference(bad)).toThrow()
  })

  it('rejects relevance outside 0..1', () => {
    expect(() => parseReference({ ...ref, relevance: 1.5 })).toThrow()
  })

  it('accepts a thumbnail without width/height (providers often omit thumb dims)', () => {
    const out = parseReference({ ...ref, thumbnail: { url: 'https://x/thumb.jpg' } })
    expect(out.thumbnail).toEqual({ url: 'https://x/thumb.jpg' })
  })

  it('accepts an optional fine-grained kind', () => {
    const base = {
      id: 'p:1',
      modality: 'image',
      source: { providerId: 'p', sourceUrl: 'https://p/1' },
      canonicalUrl: 'https://p/1',
      rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://p/1' } },
      verifiedAt: '2026-07-24T00:00:00.000Z',
      relevance: 0,
    }
    expect(parseReference({ ...base, kind: 'texture' }).kind).toBe('texture')
    expect(parseReference(base).kind).toBeUndefined()
  })
})

describe('EmittedReference → Reference', () => {
  const emitted = {
    modality: 'image', title: 'T', sourceUrl: 'https://X.test/a/', tags: ['t1'],
    rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://x.test/a' } },
    sourceScore: 12.5,
  }
  it('completeReference stamps id, source, canonicalUrl, verifiedAt and relevance', () => {
    const r = completeReference('p', parseEmitted(emitted), '2026-01-01T00:00:00.000Z')
    expect(r.id).toMatch(/^p:[0-9a-z]+$/)
    expect(r.source).toEqual({ providerId: 'p', sourceUrl: 'https://X.test/a/' })
    expect(r.canonicalUrl).toBe('https://X.test/a/')
    expect(r.verifiedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(r.relevance).toBe(0)
    expect(r.tags).toEqual(['t1'])
    expect(r.sourceScore).toBe(12.5)
    expect('sourceUrl' in r).toBe(false)
  })
  it('an explicit canonicalUrl is kept', () => {
    const r = completeReference('p', parseEmitted({ ...emitted, canonicalUrl: 'https://x.test/canon' }), '2026-01-01T00:00:00.000Z')
    expect(r.canonicalUrl).toBe('https://x.test/canon')
    expect(r.source.sourceUrl).toBe('https://X.test/a/')
  })
  it('parseEmitted rejects a missing sourceUrl', () => {
    expect(() => parseEmitted({ ...emitted, sourceUrl: undefined })).toThrow()
  })
})
