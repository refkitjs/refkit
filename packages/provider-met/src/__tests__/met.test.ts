import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { met } from '../index'

// Met search returns only IDs, so the provider does an N+1 object fetch. This
// ctx routes /search to the search body and /objects/{id} to per-object bodies.
const ctxRouting = (search: unknown, objects: Record<string, unknown>): ProviderContext => ({
  fetch: (async (input: string) => {
    const u = String(input)
    if (u.includes('/search')) return new Response(JSON.stringify(search), { status: 200 })
    const m = u.match(/\/objects\/(\d+)/)
    if (m && objects[m[1]]) return new Response(JSON.stringify(objects[m[1]]), { status: 200 })
    return new Response('null', { status: 404 })
  }) as typeof fetch,
})

const SEARCH = { total: 2, objectIDs: [436535, 999999] }
const OBJ_PD = {
  objectID: 436535, isPublicDomain: true,
  primaryImage: 'https://images.metmuseum.org/CRDImages/ep/original/DP-42549-001.jpg',
  primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ep/web-large/DP-42549-001.jpg',
  title: 'Wheat Field with Cypresses', artistDisplayName: 'Vincent van Gogh',
  objectURL: 'https://www.metmuseum.org/art/collection/search/436535', objectName: 'Painting', medium: 'Oil on canvas',
  // culture/period come back '' for this object upstream; populated here (as other Met
  // objects do return them) so the description join is exercised across all four facets
  culture: 'Dutch', period: '17th century', classification: 'Paintings',
  tags: [{ term: 'Lions' }, { term: 'Hunting' }],
}
const OBJ_COPYRIGHT = {
  objectID: 999999, isPublicDomain: false, primaryImage: '', primaryImageSmall: '',
  title: 'Modern Work', artistDisplayName: 'Living Artist',
  objectURL: 'https://www.metmuseum.org/art/collection/search/999999', objectName: 'Painting', medium: 'Acrylic',
}

describe('met provider', () => {
  it('maps public-domain objects to CC0 references and drops copyrighted (image-less) ones', async () => {
    const refs = await met().search({ text: 'wheat', modalities: ['image'], limit: 5 }, ctxRouting(SEARCH, { '436535': OBJ_PD, '999999': OBJ_COPYRIGHT }))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.author).toBe('Vincent van Gogh')
    expect(r.title).toBe('Wheat Field with Cypresses')
    expect(r.sourceUrl).toBe('https://www.metmuseum.org/art/collection/search/436535')
    expect(r.preview?.url).toContain('original/DP-42549-001.jpg')
    expect(r.thumbnail?.url).toContain('web-large')
    expect(r.description).toBe('Painting. Oil on canvas. Dutch. 17th century')
    expect(r.tags).toEqual(['Paintings', 'Lions', 'Hunting'])
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('omits description segments the object leaves blank and omits tags entirely when there are none', async () => {
    const sparse = {
      objectID: 1, isPublicDomain: true,
      primaryImage: 'https://images.metmuseum.org/CRDImages/ph/original/DP1.jpg',
      primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ph/web-large/DP1.jpg',
      title: 'Untitled', artistDisplayName: '',
      objectURL: 'https://www.metmuseum.org/art/collection/search/1',
      objectName: 'Photograph', medium: 'Gelatin silver print',
      culture: '', period: '', classification: '', tags: null,
    }
    const refs = await met().search({ text: 'x', modalities: ['image'] }, ctxRouting({ total: 1, objectIDs: [1] }, { '1': sparse }))
    expect(refs[0].description).toBe('Photograph. Gelatin silver print')
    expect(refs[0].tags).toBeUndefined()
  })

  it('returns [] when the search finds nothing', async () => {
    const refs = await met().search({ text: 'zzz', modalities: ['image'] }, ctxRouting({ total: 0, objectIDs: null }, {}))
    expect(refs).toEqual([])
  })

  // /v1/search was retired on 2026-10-01 (410 Gone). /v1.1/search takes the same filters but
  // returns one page of ids per request (offset/limit); object records stay on /v1/objects.
  it('asks the paginated v1.1 search for one page and reads objects from v1', async () => {
    const urls: string[] = []
    const inner = ctxRouting(SEARCH, { '436535': OBJ_PD, '999999': OBJ_COPYRIGHT })
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        urls.push(String(input))
        return inner.fetch(input, init)
      }) as typeof fetch,
    }
    await met().search({ text: 'wheat', modalities: ['image'], limit: 5 }, ctx)
    const search = new URL(urls[0])
    expect(search.pathname).toBe('/public/collection/v1.1/search')
    expect(search.searchParams.get('offset')).toBe('0')
    expect(search.searchParams.get('limit')).toBe('5')
    expect(urls.slice(1).map(u => new URL(u).pathname).sort()).toEqual([
      '/public/collection/v1/objects/436535',
      '/public/collection/v1/objects/999999',
    ])
  })

  it('pages upstream with offset and maps every id the page returns', async () => {
    let searchUrl = ''
    const inner = ctxRouting({ total: 40, objectIDs: [436535, 1] }, { '436535': OBJ_PD, '1': { ...OBJ_PD, objectID: 1, title: 'Second' } })
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(input).includes('/search')) searchUrl = String(input)
        return inner.fetch(input, init)
      }) as typeof fetch,
    }
    const refs = await met().search({ text: 'wheat', modalities: ['image'], limit: 2, controls: { page: 3 } }, ctx)
    expect(new URL(searchUrl).searchParams.get('offset')).toBe('4')
    expect(new URL(searchUrl).searchParams.get('limit')).toBe('2')
    expect(refs.map(r => r.title)).toEqual(['Wheat Field with Cypresses', 'Second'])
  })

  it('never fetches more objects than one page even if upstream returns extra ids', async () => {
    let objectFetches = 0
    const ids = [436535, 2, 3, 4, 5, 6]
    const inner = ctxRouting({ total: 6, objectIDs: ids }, Object.fromEntries(ids.map(id => [String(id), { ...OBJ_PD, objectID: id }])))
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(input).includes('/objects/')) objectFetches++
        return inner.fetch(input, init)
      }) as typeof fetch,
    }
    const refs = await met().search({ text: 'wheat', modalities: ['image'], limit: 3 }, ctx)
    expect(objectFetches).toBe(3)
    expect(refs).toHaveLength(3)
  })

  it('forwards documented Met search options', async () => {
    let searchUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        const u = String(input)
        if (u.includes('/search')) {
          searchUrl = u
          return new Response(JSON.stringify({ total: 0, objectIDs: null }), { status: 200 })
        }
        return new Response('null', { status: 404 })
      }) as typeof fetch,
    }
    await met().search({
      text: 'wheat',
      modalities: ['image'],
      providerOptions: {
        isHighlight: true,
        title: true,
        tags: true,
        departmentId: 11,
        isOnView: true,
        artistOrCulture: true,
        medium: 'Oil Paintings',
        geoLocation: 'France',
        dateBegin: 1700,
        dateEnd: 1800,
      },
    }, ctx)
    const url = new URL(searchUrl)
    expect(url.searchParams.get('isHighlight')).toBe('true')
    expect(url.searchParams.get('title')).toBe('true')
    expect(url.searchParams.get('tags')).toBe('true')
    expect(url.searchParams.get('departmentId')).toBe('11')
    expect(url.searchParams.get('isOnView')).toBe('true')
    expect(url.searchParams.get('artistOrCulture')).toBe('true')
    expect(url.searchParams.get('medium')).toBe('Oil Paintings')
    expect(url.searchParams.get('geoLocation')).toBe('France')
    expect(url.searchParams.get('dateBegin')).toBe('1700')
    expect(url.searchParams.get('dateEnd')).toBe('1800')
    expect(url.searchParams.get('hasImages')).toBe('true')
  })

  it('declares kinds and description', () => {
    const p = met()
    expect(p.kinds).toEqual(['artwork'])
    expect(p.description).toBeTruthy()
  })
})
