import { describe, expect, it } from 'vitest'
import { defineProvider, type ProviderContext, type Reference } from '@refkit/core'
import { expectLicenseMap, searchConformant, type LicenseMapResult } from '../index'

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

  it('accepts an extensionless CDN-style thumbnail (real providers: openverse /thumb/, smithsonian deliveryService)', async () => {
    const provider = fakeProvider([
      baseRef({ thumbnail: { url: 'https://api.example.org/v1/images/x/thumb/' } }),
    ])
    const refs = await searchConformant(provider, fixtureFetch)
    expect(refs).toHaveLength(1)
  })

  it('fails when an image provider reuses the landing page as the thumbnail (D8)', async () => {
    const provider = fakeProvider([
      baseRef({ thumbnail: { url: 'https://example.com/photo/1' } }), // === canonicalUrl: the page itself
    ])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/thumbnail\.url is the item's landing page/)
  })

  it('fails when an image provider emits a preview with non-image mediaType (D8)', async () => {
    const provider = fakeProvider([
      baseRef({ preview: { url: 'https://example.com/photo/1', mediaType: 'text/html' } }),
    ])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/image preview has non-image mediaType: text\/html/)
  })

  it('fails when a ref carries a different provider\'s id prefix', async () => {
    const provider = fakeProvider([baseRef({ id: 'other:abc123' })])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/id does not identify the provider/)
  })

  it('fails when source.providerId does not match the provider', async () => {
    const provider = fakeProvider([
      baseRef({ source: { providerId: 'other', sourceUrl: 'https://example.com/photo/1' } }),
    ])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/source\.providerId does not match the provider/)
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

  it('compares objects field-wise, insensitive to key order', () => {
    // Construct the result with keys in the opposite order of the expectation.
    const mapFn = (): LicenseMapResult => JSON.parse('{"version":"4.0","license":"CC-BY"}') as LicenseMapResult
    expect(() =>
      expectLicenseMap(mapFn, [{ input: 'x', expect: { license: 'CC-BY', version: '4.0' } }]),
    ).not.toThrow()
  })

  it('ignores extra jurisdiction on the result unless the expectation specifies it (mapRightsUrl shape)', () => {
    const mapFn = (): LicenseMapResult => ({ license: 'PD', jurisdiction: 'US' })
    // Matches when jurisdiction is asserted…
    expect(() =>
      expectLicenseMap(mapFn, [{ input: 'noc-us', expect: { license: 'PD', jurisdiction: 'US' } }]),
    ).not.toThrow()
    // …and when the expectation omits it entirely.
    expect(() =>
      expectLicenseMap(mapFn, [{ input: 'noc-us', expect: { license: 'PD' } }]),
    ).not.toThrow()
    // But a WRONG asserted jurisdiction still fails.
    expect(() =>
      expectLicenseMap(mapFn, [{ input: 'noc-us', expect: { license: 'PD', jurisdiction: 'DE' } }]),
    ).toThrowError(/license mapping mismatches/)
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
