import { describe, expect, it } from 'vitest'
import { parseReference, referenceSchema, type Reference } from '../reference'

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
    const { canonicalUrl, ...bad } = ref
    expect(() => parseReference(bad)).toThrow()
  })

  it('rejects a reference missing rights (provenance required)', () => {
    const { rights, ...bad } = ref
    expect(() => parseReference(bad)).toThrow()
  })

  it('rejects relevance outside 0..1', () => {
    expect(() => parseReference({ ...ref, relevance: 1.5 })).toThrow()
  })

  it('accepts a thumbnail without width/height (providers often omit thumb dims)', () => {
    const out = parseReference({ ...ref, thumbnail: { url: 'https://x/thumb.jpg' } })
    expect(out.thumbnail).toEqual({ url: 'https://x/thumb.jpg' })
  })
})
