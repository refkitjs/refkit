import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { smithsonian } from '../index'

const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

const FIXTURE = {
  status: 200, responseCode: 1,
  response: {
    rowCount: 2, numFound: 100,
    rows: [
      {
        id: 'edanmdm-1', title: 'Blue Morpho Butterfly',
        content: { descriptiveNonRepeating: {
          title: { label: 'Title', content: 'Blue Morpho Butterfly' },
          record_link: 'https://www.si.edu/object/edanmdm-1',
          guid: 'http://n2t.net/ark:/65665/1',
          online_media: { mediaCount: 1, media: [{
            type: 'Images',
            content: 'https://ids.si.edu/ids/deliveryService?id=NMNH-1',
            thumbnail: 'https://ids.si.edu/ids/deliveryService?id=NMNH-1&max=200',
            usage: { access: 'CC0' },
          }] },
        } },
      },
      {
        id: 'edanmdm-2', title: 'Restricted Object',
        content: { descriptiveNonRepeating: {
          title: { content: 'Restricted Object' },
          record_link: 'https://www.si.edu/object/edanmdm-2',
          online_media: { media: [{ type: 'Images', content: 'https://ids.si.edu/x', usage: { access: 'Usage conditions apply' } }] },
        } },
      },
    ],
  },
}

describe('smithsonian provider', () => {
  it('maps CC0 image media to references and drops non-CC0 records', async () => {
    const refs = await smithsonian({ apiKey: 'k' }).search({ text: 'butterfly', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.title).toBe('Blue Morpho Butterfly')
    expect(r.canonicalUrl).toBe('https://www.si.edu/object/edanmdm-1')
    expect(r.preview?.url).toBe('https://ids.si.edu/ids/deliveryService?id=NMNH-1')
    expect(r.thumbnail?.url).toContain('max=200')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('passes the api_key and query to the endpoint', async () => {
    let captured = ''
    const ctx: ProviderContext = {
      fetch: (async (u: string) => { captured = String(u); return new Response(JSON.stringify({ response: { rows: [] } }), { status: 200 }) }) as typeof fetch,
    }
    await smithsonian({ apiKey: 'SECRET' }).search({ text: 'cat', modalities: ['image'] }, ctx)
    expect(captured).toContain('api_key=SECRET')
    expect(captured).toContain('q=cat')
  })

  it('forwards documented Smithsonian search options', async () => {
    let captured = ''
    const ctx: ProviderContext = {
      fetch: (async (u: string) => { captured = String(u); return new Response(JSON.stringify({ response: { rows: [] } }), { status: 200 }) }) as typeof fetch,
    }
    await smithsonian({ apiKey: 'SECRET' }).search({
      text: 'cat',
      modalities: ['image'],
      providerOptions: {
        start: 10,
        rows: 25,
        sort: 'newest',
        type: 'all',
        rowGroup: 'archives',
        filterQuery: 'topic:"Cats"',
      },
    }, ctx)
    const url = new URL(captured)
    expect(url.searchParams.get('start')).toBe('10')
    expect(url.searchParams.get('rows')).toBe('25')
    expect(url.searchParams.get('sort')).toBe('newest')
    expect(url.searchParams.get('type')).toBe('all')
    expect(url.searchParams.get('row_group')).toBe('archives')
    expect(url.searchParams.get('fq')).toBe('online_media_type:"Images" AND media_usage:"CC0" AND topic:"Cats"')
  })
})
