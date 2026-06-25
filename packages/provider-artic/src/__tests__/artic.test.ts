import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { artic } from '../index'

const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

const FIXTURE = {
  data: [
    { id: 656, title: 'Lion (One of a Pair, South Pedestal)', image_id: '6b1edb9c-0f3f-0ee3-47c7-ca25c39ee360', is_public_domain: true, artist_display: 'Edward Kemeys\nAmerican, 1843–1907' },
    { id: 777, title: 'Copyrighted Piece', image_id: 'abc', is_public_domain: false, artist_display: 'Living Artist' },
    { id: 888, title: 'PD but no image', image_id: null, is_public_domain: true, artist_display: 'Anonymous' },
  ],
  config: { iiif_url: 'https://www.artic.edu/iiif/2', website_url: 'http://www.artic.edu' },
  pagination: { total: 3, limit: 3, offset: 0, total_pages: 1, current_page: 1 },
}

describe('artic provider', () => {
  it('maps public-domain artworks to CC0 IIIF references; drops non-PD and image-less', async () => {
    const refs = await artic().search({ text: 'lion', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.author).toBe('Edward Kemeys') // first line of artist_display
    expect(r.title).toBe('Lion (One of a Pair, South Pedestal)')
    expect(r.canonicalUrl).toBe('https://www.artic.edu/artworks/656')
    expect(r.preview?.url).toBe('https://www.artic.edu/iiif/2/6b1edb9c-0f3f-0ee3-47c7-ca25c39ee360/full/843,/0/default.jpg')
    expect(r.thumbnail?.url).toBe('https://www.artic.edu/iiif/2/6b1edb9c-0f3f-0ee3-47c7-ca25c39ee360/full/200,/0/default.jpg')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('falls back to the default IIIF base when config is absent', async () => {
    const refs = await artic().search({ text: 'x', modalities: ['image'] }, ctxWith({ data: [FIXTURE.data[0]] }))
    expect(refs[0].preview?.url).toContain('https://www.artic.edu/iiif/2/')
  })

  it('forwards documented ArtIC artwork search options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await artic().search({
      text: 'lion',
      modalities: ['image'],
      providerOptions: {
        sort: 'timestamp:desc',
        from: 20,
        size: 8,
        facets: ['artist_title', 'style_titles'],
        fields: ['id', 'title', 'image_id', 'is_public_domain', 'artist_display', 'date_display'],
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('sort')).toBe('timestamp:desc')
    expect(url.searchParams.get('from')).toBe('20')
    expect(url.searchParams.get('size')).toBe('8')
    expect(url.searchParams.get('facets')).toBe('artist_title,style_titles')
    expect(url.searchParams.get('fields')).toBe('id,title,image_id,is_public_domain,artist_display,date_display')
    expect(url.searchParams.get('query[term][is_public_domain]')).toBe('true')
  })
})
