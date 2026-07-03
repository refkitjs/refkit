import { describe, expect, it } from 'vitest'
import { mapEuropeanaRights } from '../index'

describe('mapEuropeanaRights', () => {
  it('maps CC0 and Public Domain Mark to open licenses (no version)', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapEuropeanaRights('http://creativecommons.org/publicdomain/mark/1.0/')).toEqual({ license: 'PD' })
  })

  it('maps CC-BY / CC-BY-SA and captures the version', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapEuropeanaRights('https://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
  })

  it('maps NC / ND variants to their own CC families with version (not proprietary)', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc/4.0/')).toEqual({ license: 'CC-BY-NC', version: '4.0' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc-sa/4.0/')).toEqual({ license: 'CC-BY-NC-SA', version: '4.0' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'CC-BY-ND', version: '4.0' })
  })

  it('maps rightsstatements.org faithfully: InC→proprietary, NoC-US→PD+US, NoC-NC→proprietary', () => {
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-US/1.0/')).toEqual({ license: 'PD', jurisdiction: 'US' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-NC/1.0/')).toEqual({ license: 'proprietary' })
  })

  it('maps opaque/undetermined rightsstatements + empty/unrecognized to unknown', () => {
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-OKLR/1.0/')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/CNE/1.0/')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('http://example.org/some-other-license')).toEqual({ license: 'unknown' })
  })
})

import { evaluateUse, type ProviderContext } from '@refkit/core'
import { europeana } from '../index'

// Realistic Europeana Search API item shapes. Note every metadata field is an
// array; id/type/guid are scalars. id is "/datasetId/recordId" with a leading slash.
const ITEM_CC0 = {
  id: '/2048128/europeana_fashion_12345',
  type: 'IMAGE',
  title: ['A Painted Fan'],
  dataProvider: ['Rijksmuseum'],
  provider: ['Europeana Fashion'],
  edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/cc0thumb.jpg'],
  edmIsShownBy: ['https://images.example.org/cc0-full.jpg'],
  edmIsShownAt: ['https://www.rijksmuseum.nl/item/cc0'],
  rights: ['http://creativecommons.org/publicdomain/zero/1.0/'],
}
const ITEM_BY_SA = {
  id: '/9876543/abc_xyz',
  type: 'IMAGE',
  title: ['A Photographed Statue'],
  dataProvider: ['Some Museum'],
  provider: ['Some Aggregator'],
  edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/bysathumb.jpg'],
  edmIsShownBy: ['https://images.example.org/bysa-full.jpg'],
  edmIsShownAt: ['https://museum.example.org/item/bysa'],
  rights: ['https://creativecommons.org/licenses/by-sa/3.0/'],
}
const ITEM_INC = {
  id: '/111/in_copyright',
  type: 'IMAGE',
  title: ['A Modern Photo'],
  dataProvider: ['Living Archive'],
  provider: ['Aggregator'],
  edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/incthumb.jpg'],
  edmIsShownBy: ['https://images.example.org/inc-full.jpg'],
  edmIsShownAt: ['https://archive.example.org/item/inc'],
  rights: ['http://rightsstatements.org/vocab/InC/1.0/'],
}

const okCtx = (items: unknown[]): ProviderContext => ({
  fetch: (async () =>
    new Response(JSON.stringify({ success: true, itemsCount: items.length, totalResults: items.length, items }), { status: 200 })
  ) as typeof fetch,
})

describe('europeana toReference', () => {
  it('maps a CC0 image to an allowed reference with hotlink rehost policy', async () => {
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'fan', modalities: ['image'], limit: 5 }, okCtx([ITEM_CC0]))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.title).toBe('A Painted Fan')
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.rehostPolicy).toBe('hotlink-required')
    expect(r.canonicalUrl).toBe('https://www.europeana.eu/item/2048128/europeana_fashion_12345')
    expect(r.preview?.url).toBe('https://images.example.org/cc0-full.jpg') // from edmIsShownBy
    expect(r.thumbnail?.url).toBe('https://api.europeana.eu/thumbnail/v3/200/cc0thumb.jpg') // from edmPreview
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('preserves the CC-BY-SA version and gates to allowed-with-attribution', async () => {
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'statue', modalities: ['image'] }, okCtx([ITEM_BY_SA]))
    const r = refs[0]
    expect(r.rights.license).toBe('CC-BY-SA')
    expect(r.rights.licenseVersion).toBe('3.0')
    expect(r.rights.rehostPolicy).toBe('hotlink-required')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('maps an in-copyright (InC) rights statement to proprietary → denied', async () => {
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'photo', modalities: ['image'] }, okCtx([ITEM_INC]))
    const r = refs[0]
    expect(r.rights.license).toBe('proprietary')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('denied')
  })

  it('maps NoC-US to PD scoped to the US (allowed by default; jurisdiction-aware callers gate)', async () => {
    const nocUs = { ...ITEM_CC0, id: '/x/noc_us', rights: ['http://rightsstatements.org/vocab/NoC-US/1.0/'] }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([nocUs]))
    const r = refs[0]
    expect(r.rights.license).toBe('PD')
    expect(r.rights.jurisdiction).toBe('US')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
    // a caller whose jurisdiction differs from the source's is deferred to review:
    expect(evaluateUse(r.rights, 'commercial-product', { userJurisdiction: 'DE' }).decision).toBe('needs-review')
  })

  it('drops non-IMAGE items and items with no usable media at all', async () => {
    const sound = { ...ITEM_CC0, id: '/x/sound', type: 'SOUND' }
    const noMedia = { ...ITEM_CC0, id: '/x/nomedia', edmIsShownBy: [], edmIsShownAt: [], edmPreview: [] }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([sound, noMedia, ITEM_CC0]))
    expect(refs).toHaveLength(1)
    expect(refs[0].canonicalUrl).toBe('https://www.europeana.eu/item/2048128/europeana_fashion_12345')
  })

  it('never uses edmIsShownAt (a landing page) as preview; keeps the item via its thumbnail', async () => {
    // No media resource, only a landing PAGE + a Europeana thumbnail image.
    const pageOnly = {
      ...ITEM_CC0,
      id: '/x/page_only',
      edmIsShownBy: [],
      edmIsShownAt: ['https://www.rijksmuseum.nl/en/collection/SK-A-1'], // a web page, NOT an image
      edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/pagethumb.jpg'],
    }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([pageOnly]))
    expect(refs).toHaveLength(1)
    expect(refs[0].preview).toBeUndefined() // the landing page is never surfaced as media
    expect(refs[0].thumbnail?.url).toBe('https://api.europeana.eu/thumbnail/v3/200/pagethumb.jpg')
  })

  it('reads ebucoreHasMimeType for the preview media type when the URL has no extension', async () => {
    const png = {
      ...ITEM_CC0,
      id: '/x/png',
      edmIsShownBy: ['https://images.example.org/no-extension'],
      ebucoreHasMimeType: ['image/png'],
    }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([png]))
    expect(refs[0].preview?.url).toBe('https://images.example.org/no-extension')
    expect(refs[0].preview?.mediaType).toBe('image/png')
  })
})

describe('europeana search request', () => {
  it('sets wskey, query, rows, and the image/media filters', async () => {
    let url = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        url = String(input)
        return new Response(JSON.stringify({ success: true, items: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await europeana({ apiKey: 'my-key' }).search({ text: 'tulips', modalities: ['image'], limit: 7 }, ctx)
    const u = new URL(url)
    expect(u.searchParams.get('wskey')).toBe('my-key')
    expect(u.searchParams.get('query')).toBe('tulips')
    expect(u.searchParams.get('rows')).toBe('7')
    expect(u.searchParams.get('media')).toBe('true')
    expect(u.searchParams.get('qf')).toBe('TYPE:IMAGE')
  })

  it('returns [] when the API yields no items', async () => {
    const ctx: ProviderContext = {
      fetch: (async () => new Response(JSON.stringify({ success: true, items: [] }), { status: 200 })) as typeof fetch,
    }
    expect(await europeana({ apiKey: 'k' }).search({ text: 'zzz', modalities: ['image'] }, ctx)).toEqual([])
  })

  it('throws on a non-ok HTTP status', async () => {
    const ctx: ProviderContext = {
      fetch: (async () => new Response('forbidden', { status: 401 })) as typeof fetch,
    }
    await expect(europeana({ apiKey: 'bad' }).search({ text: 'x', modalities: ['image'] }, ctx)).rejects.toThrow(/europeana search failed: 401/)
  })
})
