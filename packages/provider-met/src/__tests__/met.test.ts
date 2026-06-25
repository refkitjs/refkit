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
    expect(r.canonicalUrl).toBe('https://www.metmuseum.org/art/collection/search/436535')
    expect(r.preview?.url).toContain('original/DP-42549-001.jpg')
    expect(r.thumbnail?.url).toContain('web-large')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('returns [] when the search finds nothing', async () => {
    const refs = await met().search({ text: 'zzz', modalities: ['image'] }, ctxRouting({ total: 0, objectIDs: null }, {}))
    expect(refs).toEqual([])
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
})
