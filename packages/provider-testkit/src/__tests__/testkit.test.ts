import { describe, expect, it } from 'vitest'
import { defineProvider, type ProviderContext, type Reference } from '@refkit/core'
import { expectLicenseMap, searchConformant } from '../index'

// A minimal, otherwise-conformant reference. Individual tests override
// exactly the field under examination.
function baseRef(overrides: Partial<Reference> = {}): Reference {
  return {
    id: 'fake:abc123',
    modality: 'image',
    source: { providerId: 'fake', sourceUrl: 'https://example.com/photo/1' },
    canonicalUrl: 'https://example.com/photo/1',
    rights: {
      license: 'CC0-1.0',
      rehostPolicy: 'hotlink-required',
      raw: { sourceTerms: 'public domain', sourceUrl: 'https://example.com/terms' },
    },
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: 'https://example.com/photo/1-thumb.jpg' },
    preview: { url: 'https://example.com/photo/1-full.jpg', mediaType: 'image/jpeg' },
    relevance: 1,
    ...overrides,
  }
}

// Fixture-fetch fake provider: search() ignores ctx.fetch's real behavior and
// just returns whatever result set the test configured, but still routes
// through ctx.fetch once so the shape matches a real satellite.
function fakeProvider(results: Reference[]) {
  return defineProvider({
    id: 'fake',
    modalities: ['image'],
    queryFeatures: [],
    async search(_query, ctx: ProviderContext) {
      await ctx.fetch('https://example.com/api')
      return results
    },
  })
}

const fixtureFetch: typeof fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch

describe('searchConformant', () => {
  it('passes a conformant provider and returns parsed refs', async () => {
    const provider = fakeProvider([baseRef()])
    const refs = await searchConformant(provider, fixtureFetch)
    expect(refs).toHaveLength(1)
    expect(refs[0].id).toBe('fake:abc123')
  })

  it('fails when an image provider emits a page-URL thumbnail (D8)', async () => {
    const provider = fakeProvider([
      baseRef({ thumbnail: { url: 'https://example.com/photo/1' } }), // page URL, not an image resource
    ])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/thumbnail\.url is not image-like/)
  })

  it('fails when licenseVersion is stamped on a non-CC-family license (CC0-1.0)', async () => {
    const provider = fakeProvider([
      baseRef({
        rights: {
          license: 'CC0-1.0',
          licenseVersion: '4.0',
          rehostPolicy: 'hotlink-required',
          raw: { sourceTerms: 'public domain', sourceUrl: 'https://example.com/terms' },
        },
      }),
    ])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/carries licenseVersion on non-CC-family license/)
  })
})

describe('expectLicenseMap', () => {
  it('passes silently on exact matches', () => {
    expect(() =>
      expectLicenseMap((code: string) => (code === 'by' ? 'CC-BY' : 'unknown'), [
        { input: 'by', expect: 'CC-BY' },
        { input: 'zz', expect: 'unknown' },
      ]),
    ).not.toThrow()
  })

  it('reports every mismatch when the mapping is wrong', () => {
    expect(() =>
      expectLicenseMap((code: string) => (code === 'by' ? 'CC-BY-SA' : 'PD'), [
        { input: 'by', expect: 'CC-BY' },
        { input: 'zz', expect: 'unknown' },
      ]),
    ).toThrowError(/license mapping mismatches[\s\S]*by[\s\S]*zz/)
  })
})
