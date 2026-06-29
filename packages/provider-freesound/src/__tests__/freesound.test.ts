import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { freesound, mapFreesoundLicense } from '../index'

const ctxJson = (body: unknown, capture?: (url: string) => void): ProviderContext => ({
  fetch: (async (input: string) => {
    capture?.(String(input))
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch,
})

const RESULTS = {
  count: 4, next: null, previous: null,
  results: [
    { id: 1, name: 'Door creak', license: 'Attribution', username: 'alice',
      url: 'https://freesound.org/people/alice/sounds/1/',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/1/1_hq.mp3', 'preview-lq-mp3': 'https://cdn.freesound.org/previews/1/1_lq.mp3' },
      duration: 2.5, filesize: 41000, tags: ['door', 'creak'] },
    { id: 2, name: 'Loop NC', license: 'Attribution NonCommercial', username: 'bob',
      url: 'https://freesound.org/people/bob/sounds/2/',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/2/2_hq.mp3' }, duration: 5, filesize: 80000, tags: [] },
    { id: 3, name: 'Public bell', license: 'Creative Commons 0', username: 'carol',
      url: 'https://freesound.org/people/carol/sounds/3/',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/3/3_hq.mp3' }, duration: 1, filesize: 16000, tags: [] },
    { id: 4, name: 'Mystery', license: 'Weird Custom License', username: 'dave',
      url: 'https://freesound.org/people/dave/sounds/4/',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/4/4_hq.mp3' }, duration: 3, filesize: 48000, tags: [] },
  ],
}

describe('freesound provider', () => {
  it('maps each license family to audio references', async () => {
    const refs = await freesound({ apiKey: 'k' }).search({ text: 'door', modalities: ['audio'], limit: 10 }, ctxJson(RESULTS))
    expect(refs).toHaveLength(4)
    const byId = Object.fromEntries(refs.map(r => [r.canonicalUrl, r]))

    const cc = byId['https://freesound.org/people/alice/sounds/1/']
    expect(cc.modality).toBe('audio')
    expect(cc.rights.license).toBe('CC-BY')
    expect(cc.rights.author).toBe('alice')
    expect(cc.preview?.url).toBe('https://cdn.freesound.org/previews/1/1_hq.mp3')
    expect(cc.preview?.mediaType).toBe('audio/mpeg')

    const nc = byId['https://freesound.org/people/bob/sounds/2/']
    expect(nc.rights.license).toBe('proprietary')
    expect(evaluateUse(nc.rights, 'commercial-product').decision).toBe('denied')

    const cc0 = byId['https://freesound.org/people/carol/sounds/3/']
    expect(cc0.rights.license).toBe('CC0-1.0')
    expect(evaluateUse(cc0.rights, 'commercial-product').decision).toBe('allowed')

    const unk = byId['https://freesound.org/people/dave/sounds/4/']
    expect(unk.rights.license).toBe('unknown')
    expect(evaluateUse(unk.rights, 'commercial-product').decision).toBe('needs-review')
  })

  it('drops a result with no url without crashing the batch; keeps the valid one', async () => {
    const MIXED = {
      count: 2, next: null, previous: null,
      results: [
        { id: 10, name: 'No URL', license: 'Attribution', username: 'eve',
          previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/10/10_hq.mp3' } }, // url missing
        { id: 11, name: 'Good one', license: 'Creative Commons 0', username: 'frank',
          url: 'https://freesound.org/people/frank/sounds/11/',
          previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/11/11_hq.mp3' } },
      ],
    }
    const refs = await freesound({ apiKey: 'k' }).search({ text: 'x', modalities: ['audio'] }, ctxJson(MIXED))
    expect(refs).toHaveLength(1)
    expect(refs[0].canonicalUrl).toBe('https://freesound.org/people/frank/sounds/11/')
  })

  it('forwards query, token, and fields; respects limit', async () => {
    let url = ''
    await freesound({ apiKey: 'secret' }).search(
      { text: 'rain', modalities: ['audio'], limit: 7, providerOptions: { sort: 'rating_desc', filter: 'duration:[1 TO 10]' } },
      ctxJson(RESULTS, u => { url = u }),
    )
    const u = new URL(url)
    expect(u.pathname).toBe('/apiv2/search/text/')
    expect(u.searchParams.get('query')).toBe('rain')
    expect(u.searchParams.get('token')).toBe('secret')
    expect(u.searchParams.get('fields')).toContain('previews')
    expect(u.searchParams.get('fields')).toContain('license')
    expect(u.searchParams.get('page_size')).toBe('7')
    expect(u.searchParams.get('sort')).toBe('rating_desc')
    expect(u.searchParams.get('filter')).toBe('duration:[1 TO 10]')
  })
})

describe('mapFreesoundLicense', () => {
  it('maps CC name strings (D4 — no version)', () => {
    expect(mapFreesoundLicense('Attribution')).toEqual({ license: 'CC-BY' })
    expect(mapFreesoundLicense('Attribution NonCommercial')).toEqual({ license: 'proprietary' })
    expect(mapFreesoundLicense('Attribution Noncommercial')).toEqual({ license: 'proprietary' })
    expect(mapFreesoundLicense('Creative Commons 0')).toEqual({ license: 'CC0-1.0' })
    expect(mapFreesoundLicense('Sampling+')).toEqual({ license: 'proprietary' })
    expect(mapFreesoundLicense('Attribution Sampling+')).toEqual({ license: 'proprietary' })
  })

  it('maps CC deed URLs and extracts version for BY/BY-SA (D7)', () => {
    expect(mapFreesoundLicense('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapFreesoundLicense('http://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
    expect(mapFreesoundLicense('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapFreesoundLicense('http://creativecommons.org/licenses/by-nc/3.0/')).toEqual({ license: 'proprietary' })
  })

  it('returns unknown for anything unrecognized', () => {
    expect(mapFreesoundLicense('Weird Custom License')).toEqual({ license: 'unknown' })
    expect(mapFreesoundLicense('')).toEqual({ license: 'unknown' })
  })
})
