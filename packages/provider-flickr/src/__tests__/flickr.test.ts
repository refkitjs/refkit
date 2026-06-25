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
        minUploadDate: '2024-01-01',
        maxUploadDate: '2024-12-31',
        minTakenDate: '2023-01-01',
        maxTakenDate: '2023-12-31',
        bbox: '-122.6,37.6,-122.3,37.9',
        accuracy: 11,
        machineTags: ['dc:title="sunset"', 'geo:city=san-francisco'],
        machineTagMode: 'any',
        groupId: '123@N00',
        woeId: '2487956',
        placeId: 'abc123',
        hasGeo: true,
        geoContext: 2,
        lat: '37.7749',
        lon: '-122.4194',
        radius: 10,
        radiusUnits: 'km',
        isCommons: true,
        inGallery: true,
        isGetty: false,
        extras: ['description', 'tags'],
        page: 2,
        perPage: 50,
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('license')).toBe('4,5')
    expect(url.searchParams.get('sort')).toBe('interestingness-desc')
    expect(url.searchParams.get('safe_search')).toBe('1')
    expect(url.searchParams.get('tags')).toBe('bay,sunset')
    expect(url.searchParams.get('tag_mode')).toBe('all')
    expect(url.searchParams.get('user_id')).toBe('99@N00')
    expect(url.searchParams.get('min_upload_date')).toBe('2024-01-01')
    expect(url.searchParams.get('max_upload_date')).toBe('2024-12-31')
    expect(url.searchParams.get('min_taken_date')).toBe('2023-01-01')
    expect(url.searchParams.get('max_taken_date')).toBe('2023-12-31')
    expect(url.searchParams.get('bbox')).toBe('-122.6,37.6,-122.3,37.9')
    expect(url.searchParams.get('accuracy')).toBe('11')
    expect(url.searchParams.get('machine_tags')).toBe('dc:title="sunset",geo:city=san-francisco')
    expect(url.searchParams.get('machine_tag_mode')).toBe('any')
    expect(url.searchParams.get('group_id')).toBe('123@N00')
    expect(url.searchParams.get('woe_id')).toBe('2487956')
    expect(url.searchParams.get('place_id')).toBe('abc123')
    expect(url.searchParams.get('has_geo')).toBe('1')
    expect(url.searchParams.get('geo_context')).toBe('2')
    expect(url.searchParams.get('lat')).toBe('37.7749')
    expect(url.searchParams.get('lon')).toBe('-122.4194')
    expect(url.searchParams.get('radius')).toBe('10')
    expect(url.searchParams.get('radius_units')).toBe('km')
    expect(url.searchParams.get('is_commons')).toBe('1')
    expect(url.searchParams.get('in_gallery')).toBe('1')
    expect(url.searchParams.get('is_getty')).toBe('0')
    expect(url.searchParams.get('extras')).toContain('description')
    expect(url.searchParams.get('extras')).toContain('license')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('50')
  })

  it('maps unified controls to documented Flickr search params', async () => {
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
      controls: {
        sort: 'interesting',
        safety: 'strict',
        license: { commercial: true, modification: true },
        creator: { id: '99@N00' },
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('sort')).toBe('interestingness-desc')
    expect(url.searchParams.get('safe_search')).toBe('1')
    expect(url.searchParams.get('license')).toBe('4,5,9,10,11,12')
    expect(url.searchParams.get('user_id')).toBe('99@N00')
  })

  it('lets explicit Flickr providerOptions override equivalent unified controls', async () => {
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
      controls: {
        sort: 'interesting',
        safety: 'strict',
        license: { commercial: true, modification: true },
        creator: { id: 'control-user' },
      },
      providerOptions: {
        licenseFilter: '4,5',
        sort: 'date-taken-desc',
        safeSearch: 3,
        userId: 'option-user',
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('license')).toBe('4,5')
    expect(url.searchParams.get('sort')).toBe('date-taken-desc')
    expect(url.searchParams.get('safe_search')).toBe('3')
    expect(url.searchParams.get('user_id')).toBe('option-user')
  })
})
