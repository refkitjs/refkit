import { describe, expect, it } from 'vitest'
import { evaluateUse, referenceId, type ProviderContext } from '@refkit/core'
import { rijksmuseum } from '../index'

interface Captures {
  search?: (url: string) => void
  record?: (url: string) => void
}

// Search returns IDs only, so route the collection page separately from each
// one-hop EDM aggregation response.
const ctxRouting = (
  list: unknown,
  records: Record<string, unknown>,
  captures: Captures = {},
): ProviderContext => ({
  fetch: (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input)
    if (url.includes('/search/collection')) {
      captures.search?.(url)
      return new Response(JSON.stringify(list), { status: 200 })
    }
    captures.record?.(url)
    const match = url.match(/\/(\d+)(?:\?|$)/)
    if (match && Object.hasOwn(records, match[1])) {
      return new Response(JSON.stringify(records[match[1]]), { status: 200 })
    }
    return new Response('null', { status: 404 })
  }) as typeof fetch,
})

const LIST = {
  '@context': 'https://linked.art/ns/v1/search.json',
  type: 'OrderedCollectionPage',
  partOf: { type: 'OrderedCollection', totalItems: 3 },
  orderedItems: [
    { id: 'https://id.rijksmuseum.nl/1', type: 'HumanMadeObject' },
    { id: 'https://id.rijksmuseum.nl/2', type: 'HumanMadeObject' },
    { id: 'https://id.rijksmuseum.nl/3', type: 'HumanMadeObject' },
  ],
  next: { id: 'https://data.rijksmuseum.nl/search/collection?title=sea&pageToken=abc', type: 'OrderedCollectionPage' },
}

const EDM = {
  id: 'https://id.rijksmuseum.nl/1#aggregation',
  edmRights: 'http://creativecommons.org/publicdomain/mark/1.0/',
  isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-1' },
  isShownBy: { id: 'https://iiif.micr.io/example/full/max/0/default.jpg' },
  aggregatedCHO: {
    id: 'https://id.rijksmuseum.nl/1',
    title: { en: ['Landscape'], nl: ['Landschap'] },
    creator: [{
      'http://www.w3.org/2004/02/skos/core#prefLabel': [
        { '@language': 'en', '@value': 'Example Maker' },
      ],
    }],
  },
}

const REC_CC0 = {
  id: 'https://id.rijksmuseum.nl/2#aggregation',
  edmRights: 'https://creativecommons.org/publicdomain/zero/1.0/',
  isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-2' },
  isShownBy: { id: 'https://iiif.micr.io/cc0/full/max/0/default.jpg' },
  aggregatedCHO: {
    id: 'https://id.rijksmuseum.nl/2',
    title: { en: ['Misty Sea'] },
    creator: [{
      'http://www.w3.org/2004/02/skos/core#prefLabel': [
        { '@language': 'en', '@value': 'Jan Toorop' },
      ],
    }],
  },
}

const REC_NO_RIGHTS = {
  id: 'https://id.rijksmuseum.nl/3#aggregation',
  isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-3' },
  isShownBy: { id: 'https://iiif.micr.io/mystery/full/max/0/default.jpg' },
  aggregatedCHO: {
    id: 'https://id.rijksmuseum.nl/3',
    title: { en: ['Untitled (rights unclear)'] },
    creator: [{
      'http://www.w3.org/2004/02/skos/core#prefLabel': [
        { '@language': 'en', '@value': 'Unknown Maker' },
      ],
    }],
  },
}

describe('rijksmuseum provider', () => {
  it('fetches edm-framed JSON-LD and maps its canonical, page, image, metadata, and rights fields', async () => {
    const recordUrls: string[] = []
    const refs = await rijksmuseum().search(
      { text: 'landscape', modalities: ['image'], limit: 1 },
      ctxRouting(LIST, { '1': EDM }, { record: url => recordUrls.push(url) }),
    )

    expect(recordUrls).toHaveLength(1)
    expect(new URL(recordUrls[0]).searchParams.get('_profile')).toBe('edm-framed')
    expect(refs).toHaveLength(1)

    const landscape = refs[0]
    expect(landscape.id).toBe(referenceId('rijksmuseum', 'https://id.rijksmuseum.nl/1'))
    expect(landscape.modality).toBe('image')
    expect(landscape.title).toBe('Landscape')
    expect(landscape.rights.author).toBe('Example Maker')
    expect(landscape.rights.license).toBe('PD')
    expect(landscape.rights.licenseVersion).toBeUndefined()
    expect(landscape.source).toEqual({
      providerId: 'rijksmuseum',
      sourceUrl: 'https://www.rijksmuseum.nl/en/collection/object-1',
    })
    expect(landscape.rights.raw.sourceUrl).toBe('https://www.rijksmuseum.nl/en/collection/object-1')
    expect(landscape.canonicalUrl).toBe('https://id.rijksmuseum.nl/1')
    expect(landscape.thumbnail?.url).toBe('https://iiif.micr.io/example/full/max/0/default.jpg')
    expect(landscape.preview).toEqual({
      url: 'https://iiif.micr.io/example/full/max/0/default.jpg',
      mediaType: 'image/jpeg',
    })
    expect(evaluateUse(landscape.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('maps a CC0 record to a CC0 reference that clears a commercial-product use', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      ctxRouting(LIST, { '1': EDM, '2': REC_CC0, '3': REC_NO_RIGHTS }),
    )
    const cc0 = refs.find(ref => ref.title === 'Misty Sea')
    expect(cc0).toBeDefined()
    expect(cc0?.rights.license).toBe('CC0-1.0')
    expect(cc0?.rights.author).toBe('Jan Toorop')
    expect(cc0?.rights.licenseVersion).toBeUndefined()
    expect(evaluateUse(cc0!.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('marks a record with no rights URI as unknown and keeps it for review', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      ctxRouting(LIST, { '1': EDM, '2': REC_CC0, '3': REC_NO_RIGHTS }),
    )
    const mystery = refs.find(ref => ref.title === 'Untitled (rights unclear)')
    expect(mystery).toBeDefined()
    expect(mystery?.rights.license).toBe('unknown')
    expect(evaluateUse(mystery!.rights, 'commercial-product').decision).toBe('needs-review')
  })

  it('prefers English localized metadata, then Dutch, then the first available value', async () => {
    const records = {
      '4': {
        edmRights: 'http://creativecommons.org/publicdomain/mark/1.0/',
        isShownAt: { id: 'https://www.rijksmuseum.nl/nl/collectie/object-4' },
        isShownBy: { id: 'https://iiif.micr.io/4/full/max/0/default.jpg' },
        aggregatedCHO: {
          id: 'https://id.rijksmuseum.nl/4',
          title: { fr: ['Paysage'], nl: ['Landschap'] },
          creator: [{
            'http://www.w3.org/2004/02/skos/core#prefLabel': [
              { '@language': 'fr', '@value': 'Créateur français' },
              { '@language': 'nl', '@value': 'Nederlandse maker' },
            ],
          }],
        },
      },
      '5': {
        edmRights: 'http://creativecommons.org/publicdomain/mark/1.0/',
        isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-5' },
        isShownBy: { id: 'https://iiif.micr.io/5/full/max/0/default.jpg' },
        aggregatedCHO: {
          id: 'https://id.rijksmuseum.nl/5',
          title: { de: ['Landschaft'], fr: ['Paysage'] },
          creator: [{
            'http://www.w3.org/2004/02/skos/core#prefLabel': [
              { '@language': 'de', '@value': 'Deutscher Künstler' },
              { '@language': 'fr', '@value': 'Artiste français' },
            ],
          }],
        },
      },
    }
    const list = {
      type: 'OrderedCollectionPage',
      orderedItems: [
        { id: 'https://id.rijksmuseum.nl/4' },
        { id: 'https://id.rijksmuseum.nl/5' },
      ],
    }
    const refs = await rijksmuseum().search(
      { text: 'landscape', modalities: ['image'] },
      ctxRouting(list, records),
    )

    expect(refs.map(ref => [ref.title, ref.rights.author])).toEqual([
      ['Landschap', 'Nederlandse maker'],
      ['Landschaft', 'Deutscher Künstler'],
    ])
  })

  it('returns [] when the search finds nothing', async () => {
    const refs = await rijksmuseum().search(
      { text: 'zzz', modalities: ['image'] },
      ctxRouting({ '@context': 'x', type: 'OrderedCollectionPage', orderedItems: [] }, {}),
    )
    expect(refs).toEqual([])
  })

  it('survives a single failed per-item fetch without dropping successful siblings', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      // Record 2 is omitted, so its fetch returns 404. Records 1 and 3 still map.
      ctxRouting(LIST, { '1': EDM, '3': REC_NO_RIGHTS }),
    )
    expect(refs.map(ref => ref.title).sort()).toEqual(['Landscape', 'Untitled (rights unclear)'])
  })

  it('filters records missing either the canonical ID or an image URL', async () => {
    const list = {
      type: 'OrderedCollectionPage',
      orderedItems: [
        { id: 'https://id.rijksmuseum.nl/6' },
        { id: 'https://id.rijksmuseum.nl/7' },
      ],
    }
    const records = {
      '6': {
        edmRights: 'http://creativecommons.org/publicdomain/mark/1.0/',
        isShownBy: { id: 'https://iiif.micr.io/6/full/max/0/default.jpg' },
        aggregatedCHO: { title: { en: ['Missing canonical ID'] } },
      },
      '7': {
        edmRights: 'http://creativecommons.org/publicdomain/mark/1.0/',
        isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-7' },
        aggregatedCHO: {
          id: 'https://id.rijksmuseum.nl/7',
          title: { en: ['Missing image'] },
        },
      },
    }

    const refs = await rijksmuseum().search(
      { text: 'x', modalities: ['image'] },
      ctxRouting(list, records),
    )
    expect(refs).toEqual([])
  })

  it('falls back to object.id when isShownBy is absent', async () => {
    const record = {
      edmRights: 'http://creativecommons.org/publicdomain/mark/1.0/',
      isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-8' },
      object: { id: 'https://iiif.micr.io/8/full/max/0/default.jpg' },
      aggregatedCHO: {
        id: 'https://id.rijksmuseum.nl/8',
        title: { en: ['Object image fallback'] },
      },
    }
    const list = {
      type: 'OrderedCollectionPage',
      orderedItems: [{ id: 'https://id.rijksmuseum.nl/8' }],
    }

    const refs = await rijksmuseum().search(
      { text: 'x', modalities: ['image'] },
      ctxRouting(list, { '8': record }),
    )
    expect(refs).toHaveLength(1)
    expect(refs[0].thumbnail?.url).toBe('https://iiif.micr.io/8/full/max/0/default.jpg')
    expect(refs[0].preview?.url).toBe('https://iiif.micr.io/8/full/max/0/default.jpg')
  })

  it('maps edmRights rightsstatements.org URIs faithfully', async () => {
    const records = {
      '9': {
        edmRights: 'http://rightsstatements.org/vocab/InC/1.0/',
        isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-9' },
        isShownBy: { id: 'https://iiif.micr.io/9/full/max/0/default.jpg' },
        aggregatedCHO: {
          id: 'https://id.rijksmuseum.nl/9',
          title: { en: ['In Copyright'] },
        },
      },
      '10': {
        edmRights: 'http://rightsstatements.org/vocab/NoC-US/1.0/',
        isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-10' },
        isShownBy: { id: 'https://iiif.micr.io/10/full/max/0/default.jpg' },
        aggregatedCHO: {
          id: 'https://id.rijksmuseum.nl/10',
          title: { en: ['No Copyright US'] },
        },
      },
    }
    const list = {
      type: 'OrderedCollectionPage',
      orderedItems: [
        { id: 'https://id.rijksmuseum.nl/9' },
        { id: 'https://id.rijksmuseum.nl/10' },
      ],
    }

    const refs = await rijksmuseum().search(
      { text: 'x', modalities: ['image'] },
      ctxRouting(list, records),
    )
    const inc = refs.find(ref => ref.title === 'In Copyright')
    expect(inc?.rights.license).toBe('proprietary')
    const nocUs = refs.find(ref => ref.title === 'No Copyright US')
    expect(nocUs?.rights.license).toBe('PD')
    expect(nocUs?.rights.jurisdiction).toBe('US')
  })

  it('forwards documented search options without pageSize and limits record fetches locally', async () => {
    let searchUrl = ''
    const recordUrls: string[] = []
    await rijksmuseum().search(
      {
        text: 'vermeer',
        modalities: ['image'],
        limit: 2,
        providerOptions: {
          type: 'painting',
          material: 'canvas',
          technique: 'oil paint',
          creator: 'Johannes Vermeer',
          description: 'interior',
          imageAvailable: true,
        },
      },
      ctxRouting(
        LIST,
        { '1': EDM, '2': REC_CC0 },
        {
          search: url => { searchUrl = url },
          record: url => recordUrls.push(url),
        },
      ),
    )

    const url = new URL(searchUrl)
    expect(url.origin + url.pathname).toBe('https://data.rijksmuseum.nl/search/collection')
    expect(url.searchParams.get('title')).toBe('vermeer')
    expect(url.searchParams.get('type')).toBe('painting')
    expect(url.searchParams.get('material')).toBe('canvas')
    expect(url.searchParams.get('technique')).toBe('oil paint')
    expect(url.searchParams.get('creator')).toBe('Johannes Vermeer')
    expect(url.searchParams.get('description')).toBe('interior')
    expect(url.searchParams.get('imageAvailable')).toBe('true')
    expect(url.searchParams.get('pageSize')).toBeNull()
    expect(url.searchParams.get('key')).toBeNull()
    expect(recordUrls).toHaveLength(2)
    expect(recordUrls.some(recordUrl => recordUrl.includes('/3?'))).toBe(false)
  })
})
