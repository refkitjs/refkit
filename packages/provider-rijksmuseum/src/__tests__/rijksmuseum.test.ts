import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { rijksmuseum } from '../index'

// Search returns IDs only → N+1 record fetch. Route /search/collection to the
// list body, and each /{id} (with ?_profile=la) to its record body.
const ctxRouting = (
  list: unknown,
  records: Record<string, unknown>,
  capture?: (searchUrl: string) => void,
): ProviderContext => ({
  fetch: (async (input: Parameters<typeof fetch>[0]) => {
    const u = String(input)
    if (u.includes('/search/collection')) {
      capture?.(u)
      return new Response(JSON.stringify(list), { status: 200 })
    }
    const m = u.match(/\/(\d+)(?:\?|$)/)
    if (m && records[m[1]]) return new Response(JSON.stringify(records[m[1]]), { status: 200 })
    return new Response('null', { status: 404 })
  }) as typeof fetch,
})

const LIST = {
  '@context': 'https://linked.art/ns/v1/search.json',
  type: 'OrderedCollectionPage',
  partOf: { type: 'OrderedCollection', totalItems: 3 },
  orderedItems: [
    { id: 'https://id.rijksmuseum.nl/200100988', type: 'HumanMadeObject' },
    { id: 'https://id.rijksmuseum.nl/200100777', type: 'HumanMadeObject' },
    { id: 'https://id.rijksmuseum.nl/200100666', type: 'HumanMadeObject' },
  ],
  next: { id: 'https://data.rijksmuseum.nl/search/collection?title=sea&pageToken=abc', type: 'OrderedCollectionPage' },
}

// CC0 record (verified shape: title=identified_by[].content of type Name; creator
// via produced_by.carried_out_by; rights URI under subject_to.classified_as.id;
// image under digitally_carried_by.access_point.id).
const REC_CC0 = {
  id: 'https://id.rijksmuseum.nl/200100988',
  type: 'HumanMadeObject',
  identified_by: [
    { type: 'Name', classified_as: [{ id: 'http://vocab.getty.edu/aat/300404670', _label: 'preferred terms' }], content: 'Misty Sea' },
  ],
  produced_by: {
    type: 'Production',
    carried_out_by: [{ id: 'https://id.rijksmuseum.nl/person/toorop', type: 'Person', _label: 'Jan Toorop' }],
  },
  subject_to: [
    { type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/zero/1.0/', _label: 'CC0 1.0' }] },
  ],
  subject_of: [
    { type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://lh3.googleusercontent.com/cc0-image=s0', type: 'DigitalObject' }] }] },
  ],
}

// Public Domain Mark record.
const REC_PDM = {
  id: 'https://id.rijksmuseum.nl/200100777',
  type: 'HumanMadeObject',
  identified_by: [{ type: 'Name', content: 'Old Engraving' }],
  produced_by: { type: 'Production', carried_out_by: [{ type: 'Person', _label: 'Anonymous' }] },
  subject_to: [{ type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/mark/1.0/', _label: 'PDM' }] }],
  subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://lh3.googleusercontent.com/pdm-image=s0' }] }] }],
}

// Rights-less record: no creativecommons/rightsstatements URI anywhere → unknown.
const REC_NO_RIGHTS = {
  id: 'https://id.rijksmuseum.nl/200100666',
  type: 'HumanMadeObject',
  identified_by: [{ type: 'Name', content: 'Untitled (rights unclear)' }],
  produced_by: { type: 'Production', carried_out_by: [{ type: 'Person', _label: 'Unknown Maker' }] },
  subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://lh3.googleusercontent.com/mystery=s0' }] }] }],
}

describe('rijksmuseum provider', () => {
  it('maps a CC0 record to a CC0 reference that clears a commercial-product use', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'], limit: 10 },
      ctxRouting(LIST, { '200100988': REC_CC0, '200100777': REC_PDM, '200100666': REC_NO_RIGHTS }),
    )
    const cc0 = refs.find(r => r.title === 'Misty Sea')!
    expect(cc0.modality).toBe('image')
    expect(cc0.rights.license).toBe('CC0-1.0')
    expect(cc0.rights.author).toBe('Jan Toorop')
    expect(cc0.canonicalUrl).toBe('https://id.rijksmuseum.nl/200100988')
    expect(cc0.preview?.url).toContain('googleusercontent')
    expect(cc0.rights.licenseVersion).toBeUndefined() // CC0/PD never set version
    expect(evaluateUse(cc0.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('maps a Public Domain Mark record to PD', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      ctxRouting(LIST, { '200100988': REC_CC0, '200100777': REC_PDM, '200100666': REC_NO_RIGHTS }),
    )
    const pd = refs.find(r => r.title === 'Old Engraving')!
    expect(pd.rights.license).toBe('PD')
    expect(evaluateUse(pd.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('marks a record with no parseable open-rights URI as unknown → needs-review (not dropped)', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      ctxRouting(LIST, { '200100988': REC_CC0, '200100777': REC_PDM, '200100666': REC_NO_RIGHTS }),
    )
    const mystery = refs.find(r => r.title === 'Untitled (rights unclear)')!
    expect(mystery).toBeDefined() // kept, not silently dropped
    expect(mystery.rights.license).toBe('unknown')
    expect(evaluateUse(mystery.rights, 'commercial-product').decision).toBe('needs-review')
  })

  it('returns [] when the search finds nothing', async () => {
    const refs = await rijksmuseum().search(
      { text: 'zzz', modalities: ['image'] },
      ctxRouting({ '@context': 'x', type: 'OrderedCollectionPage', orderedItems: [] }, {}),
    )
    expect(refs).toEqual([])
  })

  it('survives a single failed per-item fetch without dropping the batch', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      // 200100777 record omitted → its fetch 404s; the other two must still map.
      ctxRouting(LIST, { '200100988': REC_CC0, '200100666': REC_NO_RIGHTS }),
    )
    expect(refs.map(r => r.title).sort()).toEqual(['Misty Sea', 'Untitled (rights unclear)'])
  })

  it('drops a record whose only access_point is a viewer/collection page (never a non-image preview)', async () => {
    // No `format`/IIIF on the DigitalObject and the access_point is a web page, not an
    // image → findImage() returns undefined → the item is dropped (not surfaced with a
    // webpage in preview.url).
    const REC_PAGE_ONLY = {
      id: 'https://id.rijksmuseum.nl/200100555',
      type: 'HumanMadeObject',
      identified_by: [{ type: 'Name', content: 'Viewer Only' }],
      subject_to: [{ type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/zero/1.0/' }] }],
      subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://www.rijksmuseum.nl/en/collection/SK-A-1' }] }] }],
    }
    const ONE = {
      type: 'OrderedCollectionPage',
      orderedItems: [{ id: 'https://id.rijksmuseum.nl/200100555', type: 'HumanMadeObject' }],
    }
    const refs = await rijksmuseum().search(
      { text: 'x', modalities: ['image'] },
      ctxRouting(ONE, { '200100555': REC_PAGE_ONLY }),
    )
    expect(refs).toEqual([])
  })

  it('prefers an image-typed (format/IIIF) DigitalObject over a non-image access_point', async () => {
    // The first access_point is a page; a second DigitalObject is typed image/jpeg →
    // findImage() must pick the typed one and carry its mediaType.
    const REC_TYPED = {
      id: 'https://id.rijksmuseum.nl/200100444',
      type: 'HumanMadeObject',
      identified_by: [{ type: 'Name', content: 'Typed Image' }],
      subject_to: [{ type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/zero/1.0/' }] }],
      subject_of: [
        { type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://www.rijksmuseum.nl/en/collection/SK-A-2' }] }] },
        { type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', format: 'image/jpeg', access_point: [{ id: 'https://iiif.example.org/image/abc/full/full/0/default.jpg' }] }] },
      ],
    }
    const ONE = { type: 'OrderedCollectionPage', orderedItems: [{ id: 'https://id.rijksmuseum.nl/200100444', type: 'HumanMadeObject' }] }
    const refs = await rijksmuseum().search({ text: 'x', modalities: ['image'] }, ctxRouting(ONE, { '200100444': REC_TYPED }))
    expect(refs).toHaveLength(1)
    expect(refs[0].preview?.url).toBe('https://iiif.example.org/image/abc/full/full/0/default.jpg')
    expect(refs[0].preview?.mediaType).toBe('image/jpeg')
  })

  it('maps a found rightsstatements.org URI faithfully (InC→proprietary, NoC-US→PD+US)', async () => {
    // findRightsUrl matches rightsstatements.org; mapping must honor it, not collapse to unknown.
    const REC_INC = {
      id: 'https://id.rijksmuseum.nl/200100333',
      type: 'HumanMadeObject',
      identified_by: [{ type: 'Name', content: 'In Copyright' }],
      subject_to: [{ type: 'Right', classified_as: [{ id: 'http://rightsstatements.org/vocab/InC/1.0/' }] }],
      subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', format: 'image/jpeg', access_point: [{ id: 'https://iiif.example.org/inc/full/full/0/default.jpg' }] }] }],
    }
    const REC_NOC_US = {
      id: 'https://id.rijksmuseum.nl/200100222',
      type: 'HumanMadeObject',
      identified_by: [{ type: 'Name', content: 'No Copyright US' }],
      subject_to: [{ type: 'Right', classified_as: [{ id: 'http://rightsstatements.org/vocab/NoC-US/1.0/' }] }],
      subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', format: 'image/jpeg', access_point: [{ id: 'https://iiif.example.org/noc/full/full/0/default.jpg' }] }] }],
    }
    const TWO = {
      type: 'OrderedCollectionPage',
      orderedItems: [
        { id: 'https://id.rijksmuseum.nl/200100333', type: 'HumanMadeObject' },
        { id: 'https://id.rijksmuseum.nl/200100222', type: 'HumanMadeObject' },
      ],
    }
    const refs = await rijksmuseum().search(
      { text: 'x', modalities: ['image'] },
      ctxRouting(TWO, { '200100333': REC_INC, '200100222': REC_NOC_US }),
    )
    const inc = refs.find(r => r.title === 'In Copyright')!
    expect(inc.rights.license).toBe('proprietary')
    const nocUs = refs.find(r => r.title === 'No Copyright US')!
    expect(nocUs.rights.license).toBe('PD')
    expect(nocUs.rights.jurisdiction).toBe('US')
  })

  it('forwards the keyword and documented search options + caps the page size to the limit', async () => {
    let searchUrl = ''
    await rijksmuseum().search(
      {
        text: 'vermeer',
        modalities: ['image'],
        limit: 5,
        providerOptions: { type: 'painting', material: 'canvas', technique: 'oil paint', creator: 'Johannes Vermeer', imageAvailable: true },
      },
      ctxRouting({ type: 'OrderedCollectionPage', orderedItems: [] }, {}, (u) => { searchUrl = u }),
    )
    const url = new URL(searchUrl)
    expect(url.origin + url.pathname).toBe('https://data.rijksmuseum.nl/search/collection')
    expect(url.searchParams.get('title')).toBe('vermeer')        // primary keyword param
    expect(url.searchParams.get('type')).toBe('painting')
    expect(url.searchParams.get('material')).toBe('canvas')
    expect(url.searchParams.get('technique')).toBe('oil paint')
    expect(url.searchParams.get('creator')).toBe('Johannes Vermeer')
    expect(url.searchParams.get('imageAvailable')).toBe('true')
    expect(url.searchParams.get('pageSize')).toBe('5')           // limit → page size cap
    // keyless: never a key param
    expect(url.searchParams.get('key')).toBeNull()
  })
})
