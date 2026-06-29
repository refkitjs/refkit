import { describe, expect, it } from 'vitest'
import { mapIaLicense, mediatypeToModality } from '../index'

describe('mapIaLicense', () => {
  it('maps CC0 / PD mark / PD dedication URLs', () => {
    expect(mapIaLicense('https://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapIaLicense('http://creativecommons.org/publicdomain/mark/1.0/')).toEqual({ license: 'PD' })
  })

  it('maps CC-BY and CC-BY-SA with version (D7)', () => {
    expect(mapIaLicense('https://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapIaLicense('http://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
  })

  it('maps NC/ND variants to proprietary (D5)', () => {
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nc/4.0/').license).toBe('proprietary')
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nd/4.0/').license).toBe('proprietary')
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nc-sa/4.0/').license).toBe('proprietary')
  })

  it('falls back to unknown for absent / unrecognized URLs (D3)', () => {
    expect(mapIaLicense(undefined)).toEqual({ license: 'unknown' })
    expect(mapIaLicense('')).toEqual({ license: 'unknown' })
    expect(mapIaLicense('https://example.com/some-license')).toEqual({ license: 'unknown' })
  })

  it('maps rightsstatements.org faithfully (InC→proprietary, NoC-US→PD+US, opaque→unknown)', () => {
    expect(mapIaLicense('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapIaLicense('http://rightsstatements.org/vocab/NoC-US/1.0/')).toEqual({ license: 'PD', jurisdiction: 'US' })
    expect(mapIaLicense('http://rightsstatements.org/vocab/NoC-NC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapIaLicense('http://rightsstatements.org/vocab/CNE/1.0/')).toEqual({ license: 'unknown' })
  })
})

describe('mediatypeToModality (D1)', () => {
  it('maps movies→video and texts→text', () => {
    expect(mediatypeToModality('movies')).toBe('video')
    expect(mediatypeToModality('texts')).toBe('text')
  })
  it('returns null for unsupported mediatypes (filtered out of v1)', () => {
    expect(mediatypeToModality('audio')).toBeNull()
    expect(mediatypeToModality('image')).toBeNull()
    expect(mediatypeToModality('collection')).toBeNull()
    expect(mediatypeToModality('software')).toBeNull()
  })
})

import { evaluateUse, referenceId, type ProviderContext } from '@refkit/core'
import { internetArchive } from '../index'

const DOCS = [
  { // CC-BY movie, creator as a string
    identifier: 'big_buck_bunny',
    title: 'Big Buck Bunny',
    creator: 'Blender Foundation',
    licenseurl: 'https://creativecommons.org/licenses/by/3.0/',
    mediatype: 'movies',
  },
  { // movie with NO licenseurl — must NOT be dropped (D3)
    identifier: 'cbsnews-clip',
    title: 'News Clip',
    creator: 'cbsnews.com',
    mediatype: 'movies',
  },
  { // texts item, creator as an array (IA creator is multi-value)
    identifier: 'alices_adventures',
    title: "Alice's Adventures in Wonderland",
    creator: ['Carroll, Lewis', 'Tenniel, John'],
    licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    mediatype: 'texts',
  },
  { // unsupported mediatype — filtered out (D1)
    identifier: 'some_collection',
    title: 'A Collection',
    mediatype: 'collection',
  },
]

const ctxResponding = (body: unknown, onUrl?: (u: string) => void): ProviderContext => ({
  fetch: (async (input: string) => {
    onUrl?.(String(input))
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch,
})

describe('internetArchive search', () => {
  it('maps CC-BY movie with version + video modality', async () => {
    const refs = await internetArchive().search(
      { text: 'animation', modalities: ['video', 'text'], limit: 10 },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    const bunny = refs.find(r => r.id === referenceId('internet-archive', 'https://archive.org/details/big_buck_bunny'))!
    expect(bunny.modality).toBe('video')
    expect(bunny.rights.license).toBe('CC-BY')
    expect(bunny.rights.licenseVersion).toBe('3.0')
    expect(bunny.rights.author).toBe('Blender Foundation')
    expect(bunny.canonicalUrl).toBe('https://archive.org/details/big_buck_bunny')
    expect(bunny.thumbnail?.url).toBe('https://archive.org/services/img/big_buck_bunny')
    expect(bunny.preview).toBeUndefined()
    expect(evaluateUse(bunny.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('keeps a licenseurl-less movie as unknown → needs-review (D3, NOT dropped)', async () => {
    const refs = await internetArchive().search(
      { text: 'news', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    const clip = refs.find(r => r.canonicalUrl === 'https://archive.org/details/cbsnews-clip')!
    expect(clip).toBeDefined()
    expect(clip.rights.license).toBe('unknown')
    expect(evaluateUse(clip.rights, 'commercial-product').decision).toBe('needs-review')
  })

  it('maps a texts item to text modality and joins an array creator', async () => {
    const refs = await internetArchive().search(
      { text: 'alice', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    const alice = refs.find(r => r.canonicalUrl === 'https://archive.org/details/alices_adventures')!
    expect(alice.modality).toBe('text')
    expect(alice.rights.license).toBe('CC0-1.0')
    expect(alice.rights.author).toBe('Carroll, Lewis, Tenniel, John')
    expect(alice.text).toBeUndefined()
  })

  it('filters out unsupported mediatypes (collection)', async () => {
    const refs = await internetArchive().search(
      { text: 'x', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    expect(refs.map(r => r.canonicalUrl)).not.toContain('https://archive.org/details/some_collection')
    expect(refs).toHaveLength(3) // bunny + clip + alice
  })

  it('forwards query and rows to advancedsearch', async () => {
    let seen = ''
    await internetArchive({ maxRows: 7 }).search(
      { text: 'jazz', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 0, docs: [] } }, u => { seen = u }),
    )
    const url = new URL(seen)
    expect(url.pathname).toBe('/advancedsearch.php')
    expect(url.searchParams.get('q')).toBe('jazz')
    expect(url.searchParams.get('output')).toBe('json')
    expect(url.searchParams.get('rows')).toBe('7')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.getAll('fl[]')).toEqual(
      expect.arrayContaining(['identifier', 'title', 'creator', 'licenseurl', 'mediatype']),
    )
  })
})
