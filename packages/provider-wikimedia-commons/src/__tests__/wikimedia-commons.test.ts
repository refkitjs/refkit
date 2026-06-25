import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { wikimediaCommons, mapCommonsLicense } from '../index'

const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

// Shape mirrors a real commons.wikimedia.org generator=search + imageinfo/extmetadata
// response (verified live). Two items at CC BY-SA 4.0 and 3.0 to prove cross-version mapping.
const FIXTURE = {
  batchcomplete: '',
  query: {
    pages: {
      '68960758': {
        pageid: 68960758, ns: 6, title: 'File:Cat playing with a lizard.jpg', index: 1,
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Cat_playing_with_a_lizard.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cat_playing_with_a_lizard.jpg',
          mime: 'image/jpeg', width: 5557, height: 3125,
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Cat_playing_with_a_lizard.jpg/1024px-Cat_playing_with_a_lizard.jpg',
          thumbwidth: 1024, thumbheight: 576,
          extmetadata: {
            ObjectName: { value: 'Cat playing with a lizard' },
            License: { value: 'cc-by-sa-4.0' },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Basile_Morin">Basile Morin</a>' },
            AttributionRequired: { value: 'true' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
          },
        }],
      },
      '9437797': {
        pageid: 9437797, ns: 6, title: 'File:Felis catus-cat on snow.jpg', index: 2,
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/b/b6/Felis_catus-cat_on_snow.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Felis_catus-cat_on_snow.jpg',
          mime: 'image/jpeg', width: 3000, height: 2000,
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Felis_catus-cat_on_snow.jpg/1024px-Felis_catus-cat_on_snow.jpg',
          thumbwidth: 1024, thumbheight: 683,
          extmetadata: {
            ObjectName: { value: 'Felis catus-cat on snow' },
            License: { value: 'cc-by-sa-3.0' },
            LicenseShortName: { value: 'CC BY-SA 3.0' },
            Artist: { value: 'Von.grzanka' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' },
          },
        }],
      },
    },
  },
}

describe('mapCommonsLicense', () => {
  it('maps cc0 / cc-by / cc-by-sa (any version) / pd; NC-ND → proprietary; blank/unknown → unknown', () => {
    expect(mapCommonsLicense('cc0')).toEqual({ license: 'CC0-1.0' })
    expect(mapCommonsLicense('cc-by-4.0')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapCommonsLicense('cc-by-2.0')).toEqual({ license: 'CC-BY', version: '2.0' })
    expect(mapCommonsLicense('cc-by-sa-3.0')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
    expect(mapCommonsLicense('cc-by-sa-2.5-in')).toEqual({ license: 'CC-BY-SA', version: '2.5' }) // jurisdiction port
    expect(mapCommonsLicense('cc-by-3.0-us')).toEqual({ license: 'CC-BY', version: '3.0' })
    expect(mapCommonsLicense('cc-by-nc-2.0')).toEqual({ license: 'proprietary' })
    expect(mapCommonsLicense('cc-by-nd-4.0')).toEqual({ license: 'proprietary' })
    expect(mapCommonsLicense('pd')).toEqual({ license: 'PD' })
    expect(mapCommonsLicense('pd-old-100')).toEqual({ license: 'PD' })
    expect(mapCommonsLicense('')).toEqual({ license: 'unknown' })
    expect(mapCommonsLicense(undefined)).toEqual({ license: 'unknown' })
    expect(mapCommonsLicense('fair use')).toEqual({ license: 'unknown' })
  })
})

describe('wikimedia-commons provider', () => {
  it('maps files to normalized References, preserving CC version across 4.0 and 3.0', async () => {
    const refs = await wikimediaCommons().search({ text: 'cat', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(2)
    const a = refs[0]
    expect(a.rights.license).toBe('CC-BY-SA')
    expect(a.rights.licenseVersion).toBe('4.0')
    expect(a.rights.author).toBe('Basile Morin') // HTML stripped from the Artist field
    expect(a.canonicalUrl).toBe('https://commons.wikimedia.org/wiki/File:Cat_playing_with_a_lizard.jpg')
    expect(a.title).toBe('Cat playing with a lizard')
    expect(a.thumbnail?.url).toContain('1024px')
    expect(a.preview?.url).toBe('https://upload.wikimedia.org/wikipedia/commons/7/72/Cat_playing_with_a_lizard.jpg')
    expect(a.visual).toEqual({ width: 5557, height: 3125 })
    // second item is CC BY-SA 3.0 — version preserved, still allowed-with-attribution (Phase-1 fix)
    expect(refs[1].rights.licenseVersion).toBe('3.0')
    expect(evaluateUse(refs[1].rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('preserves search rank order via the generator index', async () => {
    const refs = await wikimediaCommons().search({ text: 'cat', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs.map(r => r.title)).toEqual(['Cat playing with a lizard', 'Felis catus-cat on snow'])
  })

  it('forwards documented Wikimedia generator and imageinfo options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 })
      }) as typeof fetch,
    }
    await wikimediaCommons().search({
      text: 'cat',
      modalities: ['image'],
      providerOptions: {
        gsrnamespace: '14',
        gsrlimit: 7,
        gsroffset: 20,
        gsrqiprofile: 'classic',
        gsrqdprofile: 'perfield_builder',
        gsrwhat: 'title',
        gsrinfo: ['totalhits'],
        gsrprop: ['snippet', 'timestamp'],
        gsrinterwiki: true,
        gsrenablerewrites: false,
        gsrsort: 'last_edit_desc',
        iiprop: ['commonmetadata'],
        iiurlwidth: 640,
        iiextmetadatafilter: ['License', 'Artist'],
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('gsrnamespace')).toBe('6')
    expect(url.searchParams.get('gsrlimit')).toBe('7')
    expect(url.searchParams.get('gsroffset')).toBe('20')
    expect(url.searchParams.get('gsrqiprofile')).toBe('classic')
    expect(url.searchParams.get('gsrqdprofile')).toBe('perfield_builder')
    expect(url.searchParams.get('gsrwhat')).toBe('title')
    expect(url.searchParams.get('gsrinfo')).toBe('totalhits')
    expect(url.searchParams.get('gsrprop')).toBe('snippet|timestamp')
    expect(url.searchParams.get('gsrinterwiki')).toBe('true')
    expect(url.searchParams.get('gsrenablerewrites')).toBe('false')
    expect(url.searchParams.get('gsrsort')).toBe('last_edit_desc')
    expect(url.searchParams.get('iiprop')).toContain('url')
    expect(url.searchParams.get('iiprop')).toContain('extmetadata')
    expect(url.searchParams.get('iiprop')).toContain('commonmetadata')
    expect(url.searchParams.get('iiurlwidth')).toBe('640')
    expect(url.searchParams.get('iiextmetadatafilter')).toBe('License|Artist')
  })

  it('falls back to the file name when ObjectName carries structured-data label markup', async () => {
    const QS = {
      query: { pages: { '1': {
        pageid: 1, ns: 6, title: 'File:Paul Bril 002.jpg', index: 1,
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/4/41/Paul_Bril_002.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Paul_Bril_002.jpg',
          mime: 'image/jpeg', width: 800, height: 600,
          extmetadata: {
            ObjectName: { value: 'German: Gebirgslandschaft title QS:P1476,de:"Gebirgslandschaft"label QS:Len,"Mountain landscape"' },
            License: { value: 'pd-old-100' },
          },
        }],
      } } },
    }
    const refs = await wikimediaCommons().search({ text: 'x', modalities: ['image'] }, ctxWith(QS))
    expect(refs[0].title).toBe('Paul Bril 002')
    expect(refs[0].rights.license).toBe('PD')
  })
})
