import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { jamendo, mapJamendoLicense } from '../index'

// Jamendo wraps results in { headers, results }. This ctx captures the request URL
// (to assert client_id/search/limit forwarding) and returns the supplied body.
const ctxCapturing = (body: unknown): { ctx: ProviderContext; url: () => string } => {
  let captured = ''
  const ctx: ProviderContext = {
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      captured = String(input)
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch,
  }
  return { ctx, url: () => captured }
}

const envelope = (results: unknown[]) => ({
  headers: { status: 'success', code: 0, error_message: '', results_count: results.length },
  results,
})

const TRACK_BY = {
  id: '1848357',
  name: 'Sunrise',
  artist_name: 'fankel',
  audio: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp31&from=app-devsite',
  audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1848357/mp32/',
  image: 'https://usercontent.jamendo.com?type=album&id=368084&width=300&trackid=1848357',
  shareurl: 'https://www.jamendo.com/track/1848357',
  shorturl: 'https://jamen.do/t/1848357',
  license_ccurl: 'http://creativecommons.org/licenses/by/4.0/',
}

describe('mapJamendoLicense', () => {
  it('maps CC-BY and CC-BY-SA with version, NC/ND → proprietary, missing → unknown', () => {
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapJamendoLicense('https://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toEqual({ license: 'proprietary' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nc/2.0/')).toEqual({ license: 'proprietary' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'proprietary' })
    expect(mapJamendoLicense('')).toEqual({ license: 'unknown' })
    expect(mapJamendoLicense('https://example.com/whatever')).toEqual({ license: 'unknown' })
  })
})

describe('jamendo provider', () => {
  it('maps a CC-BY track to a CC-BY audio reference (allowed-with-attribution)', async () => {
    const { ctx } = ctxCapturing(envelope([TRACK_BY]))
    const refs = await jamendo({ clientId: 'cid' }).search({ text: 'sunrise', modalities: ['audio'], limit: 5 }, ctx)
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('audio')
    expect(r.rights.license).toBe('CC-BY')
    expect(r.rights.licenseVersion).toBe('4.0')
    expect(r.rights.author).toBe('fankel')
    expect(r.title).toBe('Sunrise')
    expect(r.canonicalUrl).toBe('https://www.jamendo.com/track/1848357')
    expect(r.preview?.url).toContain('trackid=1848357')
    expect(r.preview?.mediaType).toBe('audio/mpeg')
    expect(r.thumbnail?.url).toContain('usercontent.jamendo.com')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  const TRACK_NC = {
    ...TRACK_BY,
    id: '2000001',
    name: 'For Listening Only',
    license_ccurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
    shareurl: 'https://www.jamendo.com/track/2000001',
  }

  it('maps a CC-BY-NC-ND track to proprietary → denied for commercial use', async () => {
    const { ctx } = ctxCapturing(envelope([TRACK_NC]))
    const refs = await jamendo({ clientId: 'cid' }).search({ text: 'listen', modalities: ['audio'] }, ctx)
    expect(refs).toHaveLength(1)
    expect(refs[0].rights.license).toBe('proprietary')
    expect(refs[0].rights.licenseVersion).toBeUndefined()
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('denied')
  })

  const TRACK_NO_LICENSE = {
    ...TRACK_BY,
    id: '3000002',
    name: 'Mystery Track',
    license_ccurl: '',
    shareurl: 'https://www.jamendo.com/track/3000002',
  }

  it('maps a track with no recognizable license to unknown → needs-review', async () => {
    const { ctx } = ctxCapturing(envelope([TRACK_NO_LICENSE]))
    const refs = await jamendo({ clientId: 'cid' }).search({ text: 'mystery', modalities: ['audio'] }, ctx)
    expect(refs).toHaveLength(1)
    expect(refs[0].rights.license).toBe('unknown')
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('needs-review')
  })

  const TRACK_NO_SHAREURL = {
    ...TRACK_BY,
    id: '4000003',
    name: 'No Share URL',
    shareurl: '',
  }

  it('drops a track with no shareurl without crashing the batch; keeps the valid one', async () => {
    const { ctx } = ctxCapturing(envelope([TRACK_NO_SHAREURL, TRACK_BY]))
    const refs = await jamendo({ clientId: 'cid' }).search({ text: 'x', modalities: ['audio'] }, ctx)
    expect(refs).toHaveLength(1)
    expect(refs[0].canonicalUrl).toBe('https://www.jamendo.com/track/1848357')
  })

  it('forwards client_id, search, limit, format and documented options', async () => {
    const { ctx, url } = ctxCapturing(envelope([]))
    await jamendo({ clientId: 'my-client-id' }).search({
      text: 'ambient',
      modalities: ['audio'],
      limit: 7,
      providerOptions: { audioformat: 'mp32', order: 'popularity_total', ccnc: false, tags: ['ambient', 'chill'], artist_name: 'fankel', offset: 20 },
    }, ctx)
    const u = new URL(url())
    expect(u.searchParams.get('client_id')).toBe('my-client-id')
    expect(u.searchParams.get('format')).toBe('json')
    expect(u.searchParams.get('search')).toBe('ambient')
    expect(u.searchParams.get('limit')).toBe('7')
    expect(u.searchParams.get('audioformat')).toBe('mp32')
    expect(u.searchParams.get('order')).toBe('popularity_total')
    expect(u.searchParams.get('ccnc')).toBe('false')
    expect(u.searchParams.get('tags')).toBe('ambient chill')
    expect(u.searchParams.get('artist_name')).toBe('fankel')
    expect(u.searchParams.get('offset')).toBe('20')
  })

  it('returns [] when Jamendo finds nothing', async () => {
    const { ctx } = ctxCapturing(envelope([]))
    const refs = await jamendo({ clientId: 'cid' }).search({ text: 'zzzz', modalities: ['audio'] }, ctx)
    expect(refs).toEqual([])
  })
})
