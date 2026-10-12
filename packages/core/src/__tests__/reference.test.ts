import { describe, expect, it } from 'vitest'
import { completeReference, parseEmitted, parseReference, referenceSchema, type Reference } from '../reference'
import { MODALITIES } from '../modality'

const ref: Reference = {
  id: 'p:abc',
  modality: 'image',
  title: 'Sunset',
  source: { id: 'unsplash', url: 'https://unsplash.com/photos/1' },
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
      source: { id: 'p', url: 'https://p/1' },
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
    expect(r.source).toEqual({ id: 'p', url: 'https://X.test/a/' })
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
    expect(r.source.url).toBe('https://X.test/a/')
  })
  it('parseEmitted rejects a missing sourceUrl', () => {
    expect(() => parseEmitted({ ...emitted, sourceUrl: undefined })).toThrow()
  })
})

describe('schemas: one variant per modality', () => {
  const rights = { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://x/1' } }
  const item = (modality: string, extra: Record<string, unknown> = {}) => ({ modality, sourceUrl: 'https://x/1', rights, ...extra })
  const now = '2026-01-01T00:00:00.000Z'

  it.each(MODALITIES)('a minimal %s item parses, emitted and complete', (m) => {
    const e = parseEmitted(item(m))
    expect(e.modality).toBe(m)
    expect(parseReference(completeReference('p', e, now)).modality).toBe(m)
  })

  it('rejects an unknown modality', () => {
    expect(() => parseEmitted(item('3d'))).toThrow()
  })

  it('keeps each variant\'s own fields', () => {
    const image = { preview: { url: 'https://x/1.jpg', mediaType: 'image/jpeg' }, visual: { width: 4, height: 3 }, perceptualHash: 'ff00' }
    const video = { preview: { url: 'https://x/1.mp4', mediaType: 'video/mp4', width: 640, height: 360 }, visual: { width: 1920, height: 1080 }, video: { durationSec: 12, fps: 25 } }
    const audio = { preview: { url: 'https://x/1.mp3', mediaType: 'audio/mpeg' }, audio: { durationSec: 2.5, bitrateKbps: 128, sampleRateHz: 44100, channels: 2, format: 'mp3' } }
    const text = { text: { excerpt: 'e', excerptKind: 'passage', locator: 'l. 1' } }
    expect(parseEmitted(item('image', image))).toMatchObject(image)
    expect(parseEmitted(item('video', video))).toMatchObject(video)
    expect(parseEmitted(item('audio', audio))).toMatchObject(audio)
    expect(parseEmitted(item('text', text))).toMatchObject(text)
    expect(parseReference(completeReference('p', parseEmitted(item('audio', audio)), now))).toMatchObject(audio)
  })

  it('rejects a preview whose mediaType does not start with the variant\'s prefix', () => {
    const preview = (mediaType: string) => ({ preview: { url: 'https://x/p', mediaType } })
    expect(() => parseEmitted(item('image', preview('text/html')))).toThrow()
    expect(() => parseEmitted(item('image', preview('video/mp4')))).toThrow()
    expect(() => parseEmitted(item('video', preview('image/jpeg')))).toThrow()
    expect(() => parseEmitted(item('audio', preview('application/json')))).toThrow()
    expect(() => parseReference({ ...ref, preview: { url: 'https://x/p', mediaType: 'audio/mpeg' } })).toThrow()
    expect(parseEmitted(item('image', preview('image/svg+xml'))).preview?.mediaType).toBe('image/svg+xml')
    expect(parseEmitted(item('video', preview('video/webm'))).preview?.mediaType).toBe('video/webm')
    expect(parseEmitted(item('audio', preview('audio/ogg'))).preview?.mediaType).toBe('audio/ogg')
  })

  it('strips a field that belongs to another modality instead of rejecting the item', () => {
    const audio = parseEmitted(item('audio', { visual: { width: 4, height: 3 }, text: { excerpt: 'e', excerptKind: 'quote' } }))
    expect(audio).not.toHaveProperty('visual')
    expect(audio).not.toHaveProperty('text')
    const text = parseEmitted(item('text', { preview: { url: 'https://x/p', mediaType: 'text/plain' }, audio: { durationSec: 1 } }))
    expect(text).not.toHaveProperty('preview')
    expect(text).not.toHaveProperty('audio')
    const image = parseEmitted(item('image', { video: { durationSec: 1 } }))
    expect(image).not.toHaveProperty('video')
    expect(parseReference({ ...ref, audio: { durationSec: 1 } })).not.toHaveProperty('audio')
  })
})
