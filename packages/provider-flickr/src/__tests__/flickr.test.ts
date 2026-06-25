import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { flickr, mapFlickrLicense } from '../index'

const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

const FIXTURE = {
  photos: {
    page: 1, pages: 10, perpage: 2, total: 20,
    photo: [
      {
        id: '111', owner: '99@N00', title: 'Sunset over bay', license: '4', ownername: 'Alice',
        url_t: 'https://live.staticflickr.com/1/111_t.jpg', width_t: 100, height_t: 67,
        url_m: 'https://live.staticflickr.com/1/111_m.jpg', width_m: 240, height_m: 160,
        url_l: 'https://live.staticflickr.com/1/111_b.jpg', width_l: 1024, height_l: 683,
      },
      {
        id: '222', owner: 'gov@N00', title: 'Apollo 11 liftoff', license: '8', ownername: 'NASA',
        url_t: 'https://live.staticflickr.com/2/222_t.jpg', width_t: 100, height_t: 100,
        url_l: 'https://live.staticflickr.com/2/222_b.jpg', width_l: 1024, height_l: 1024,
      },
    ],
  },
  stat: 'ok',
}

describe('mapFlickrLicense', () => {
  it('maps CC/PD/CC0 ids with versions; ARR + every NC/ND → proprietary; unknown id → unknown', () => {
    expect(mapFlickrLicense('4')).toEqual({ license: 'CC-BY', version: '2.0' })
    expect(mapFlickrLicense(11)).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapFlickrLicense('5')).toEqual({ license: 'CC-BY-SA', version: '2.0' })
    expect(mapFlickrLicense(12)).toEqual({ license: 'CC-BY-SA', version: '4.0' })
    expect(mapFlickrLicense('9')).toEqual({ license: 'CC0-1.0' })
    expect(mapFlickrLicense('7')).toEqual({ license: 'unknown' }) // "no known copyright restrictions" is not a guaranteed-free grant
    expect(mapFlickrLicense('8')).toEqual({ license: 'PD' })
    expect(mapFlickrLicense('10')).toEqual({ license: 'PD' })
    expect(mapFlickrLicense('0')).toEqual({ license: 'proprietary' })  // All Rights Reserved
    expect(mapFlickrLicense('3')).toEqual({ license: 'proprietary' })  // CC BY-NC-ND 2.0
    expect(mapFlickrLicense('16')).toEqual({ license: 'proprietary' }) // CC BY-NC-ND 4.0
    expect(mapFlickrLicense('99')).toEqual({ license: 'unknown' })
  })
})

describe('flickr provider', () => {
  it('maps photos to normalized References with per-item license + version', async () => {
    const refs = await flickr({ apiKey: 'k' }).search({ text: 'sunset', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(2)
    const r = refs[0]
    expect(r.rights.license).toBe('CC-BY')
    expect(r.rights.licenseVersion).toBe('2.0')
    expect(r.rights.author).toBe('Alice')
    expect(r.canonicalUrl).toBe('https://www.flickr.com/photos/99@N00/111')
    expect(r.title).toBe('Sunset over bay')
    expect(r.thumbnail?.url).toBe('https://live.staticflickr.com/1/111_t.jpg')
    expect(r.preview?.url).toBe('https://live.staticflickr.com/1/111_b.jpg')
    expect(r.visual).toEqual({ width: 1024, height: 683 })
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
  })

  it('END-TO-END moat: CC-BY → allowed-with-attribution, PD → allowed for commercial use', async () => {
    const refs = await flickr({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('allowed-with-attribution') // CC-BY 2.0
    expect(evaluateUse(refs[1].rights, 'commercial-product').decision).toBe('allowed')                  // PD
  })

  it('throws on a Flickr API error envelope (stat != ok)', async () => {
    await expect(
      flickr({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, ctxWith({ stat: 'fail', code: 100, message: 'Invalid API Key' })),
    ).rejects.toThrow(/flickr search error/)
  })

  it('forwards documented Flickr-specific search options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify(FIXTURE), { status: 200 })
      }) as typeof fetch,
    }
    await flickr({ apiKey: 'k' }).search({
      text: 'sunset',
      modalities: ['image'],
      providerOptions: {
        licenseFilter: '4,5',
        sort: 'interestingness-desc',
        safeSearch: 1,
        tags: ['bay', 'sunset'],
        tagMode: 'all',
        userId: '99@N00',
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('license')).toBe('4,5')
    expect(url.searchParams.get('sort')).toBe('interestingness-desc')
    expect(url.searchParams.get('safe_search')).toBe('1')
    expect(url.searchParams.get('tags')).toBe('bay,sunset')
    expect(url.searchParams.get('tag_mode')).toBe('all')
    expect(url.searchParams.get('user_id')).toBe('99@N00')
  })
})
