import { describe, expect, it } from 'vitest'
import {
  defineProvider, type EmittedAudioReference, type EmittedImageReference, type EmittedReference, type Modality, type ProviderContext,
} from '@refkit/core'
import { expectLicenseMap, searchConformant, type LicenseMapResult } from '../index'

// A minimal, otherwise-conformant emitted item. Individual tests override
// exactly the field under examination.
function baseRef(overrides: Partial<EmittedImageReference> = {}): EmittedImageReference {
  return {
    modality: 'image',
    sourceUrl: 'https://example.com/photo/1',
    rights: {
      license: 'CC0-1.0',
      rehostPolicy: 'hotlink-required',
      raw: { sourceTerms: 'public domain', sourceUrl: 'https://example.com/terms' },
    },
    thumbnail: { url: 'https://example.com/photo/1-thumb.jpg' },
    preview: { url: 'https://example.com/photo/1-full.jpg', mediaType: 'image/jpeg' },
    ...overrides,
  }
}

function audioRef(): EmittedAudioReference {
  return {
    modality: 'audio',
    sourceUrl: 'https://example.com/track/1',
    rights: {
      license: 'CC0-1.0',
      rehostPolicy: 'hotlink-required',
      raw: { sourceTerms: 'public domain', sourceUrl: 'https://example.com/terms' },
    },
    thumbnail: { url: 'https://example.com/track/1-cover.jpg' },
    preview: { url: 'https://example.com/track/1.mp3', mediaType: 'audio/mpeg' },
    audio: { durationSec: 2.5 },
  }
}

// Fixture-fetch fake provider: search() ignores ctx.fetch's real behavior and
// just returns whatever result set the test configured, but still routes
// through ctx.fetch once so the shape matches a real satellite.
function fakeProvider(results: EmittedReference[], modalities: Modality[] = ['image']) {
  return defineProvider({
    id: 'fake',
    modalities,
    async search(_query, ctx: ProviderContext) {
      await ctx.fetch('https://example.com/api')
      return results
    },
  })
}

const fixtureFetch: typeof fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch

describe('searchConformant', () => {
  it('passes a conformant provider and returns completed refs', async () => {
    const provider = fakeProvider([baseRef()])
    const refs = await searchConformant(provider, fixtureFetch)
    expect(refs).toHaveLength(1)
    expect(refs[0].id).toMatch(/^fake:/) // stamped by core, not by the provider
    expect(refs[0].source).toEqual({ providerId: 'fake', sourceUrl: 'https://example.com/photo/1' })
    expect(refs[0].canonicalUrl).toBe('https://example.com/photo/1')
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

  it('fails at the schema when an image emits a preview with a non-image mediaType (D8)', async () => {
    const provider = fakeProvider([
      baseRef({ preview: { url: 'https://example.com/photo/1', mediaType: 'text/html' } }),
    ])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/failed emittedReferenceSchema/)
  })

  it('fails at the schema when an audio item\'s preview is not audio/*', async () => {
    const provider = fakeProvider([
      { ...audioRef(), preview: { url: 'https://example.com/track/1.mp4', mediaType: 'video/mp4' } },
    ], ['audio'])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/failed emittedReferenceSchema/)
  })

  it('applies the landing-page thumbnail rule to every modality, not only image providers', async () => {
    const provider = fakeProvider([
      { ...audioRef(), thumbnail: { url: 'https://example.com/track/1' } }, // === sourceUrl: the page itself
    ], ['audio'])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/thumbnail\.url is the item's landing page/)
  })

  it('fails when a result\'s modality is not one the provider declares', async () => {
    const provider = fakeProvider([baseRef(), audioRef()], ['image'])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/result #1 modality "audio" is not in the provider's declared modalities \[image\]/)
  })

  it('fails when parseEmitted drops a key: a field from another modality', async () => {
    // The union type rejects this at compile time; the cast stands in for a
    // provider whose types were loosened (any, JSON passthrough).
    const provider = fakeProvider([{ ...baseRef(), text: { excerpt: 'e', excerptKind: 'passage' } } as unknown as EmittedReference])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/result #0 lost keys in parseEmitted: text/)
  })

  it('fails when parseEmitted drops a nested key, and names its path', async () => {
    const provider = fakeProvider([
      { ...baseRef(), visual: { width: 4, height: 3, colours: ['#fff'] } } as unknown as EmittedReference,
    ])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/lost keys in parseEmitted: visual\.colours/)
  })

  it('does not inspect raw, and does not count a key set to undefined as lost', async () => {
    const provider = fakeProvider([
      { ...baseRef(), raw: { anything: { goes: true } } },
      { ...audioRef(), visual: undefined },
    ], ['image', 'audio'])
    await expect(searchConformant(provider, fixtureFetch)).resolves.toHaveLength(2)
  })

  it('fails when a result carries no sourceUrl', async () => {
    const { sourceUrl: _sourceUrl, ...noUrl } = baseRef()
    const provider = fakeProvider([noUrl as EmittedReference])
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/failed emittedReferenceSchema/)
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
    await expect(searchConformant(provider, fixtureFetch)).rejects.toThrow(/licenseVersion is only valid on a versioned CC family license/)
  })
})

const kindRef = (kind?: string): EmittedReference => ({
  modality: 'image',
  ...(kind ? { kind } : {}),
  sourceUrl: 'https://kp/1',
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://kp/1' } },
})

describe('declared-kinds consistency', () => {
  const neverFetch = (async () => { throw new Error('no network') }) as unknown as typeof fetch

  it('rejects a result whose kind is outside the declared set', async () => {
    const p = defineProvider({ id: 'kp', modalities: ['image'], kinds: ['texture'], search: async () => [kindRef('photo')] })
    await expect(searchConformant(p, neverFetch)).rejects.toThrow(/kind "photo" is not in the provider's declared kinds/)
  })

  it('accepts a matching kind and a missing kind', async () => {
    const p = defineProvider({ id: 'kp', modalities: ['image'], kinds: ['texture'], search: async () => [kindRef('texture'), kindRef()] })
    await expect(searchConformant(p, neverFetch)).resolves.toHaveLength(2)
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
