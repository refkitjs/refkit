import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { searchConformant } from '@refkit/provider-testkit'
import { openverse, openverseAudio, mapOpenverseLicense } from '../index'

const FIXTURE = {
  results: [
    {
      id: 'aaa', title: 'blue sky', creator: 'Alice', creator_url: 'https://ex/alice',
      foreign_landing_url: 'https://ex/photo/aaa', url: 'https://cdn/aaa.jpg',
      thumbnail: 'https://api.openverse.org/v1/images/aaa/thumb/',
      width: 1024, height: 683, license: 'cc0', license_version: '1.0',
      license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: '"blue sky" by Alice is marked with CC0 1.0.',
    },
    {
      id: 'bbb', title: 'mountain', creator: 'barnyz', creator_url: 'https://flickr/barnyz',
      foreign_landing_url: 'https://www.flickr.com/photos/x/38422248024', url: 'https://live.staticflickr.com/x_b.jpg',
      thumbnail: 'https://api.openverse.org/v1/images/bbb/thumb/',
      width: 1024, height: 683, license: 'by-nc-nd', license_version: '2.0',
      license_url: 'https://creativecommons.org/licenses/by-nc-nd/2.0/',
      attribution: '"mountain" by barnyz is licensed under CC BY-NC-ND 2.0.',
    },
  ],
}

const ctxWith = (body: unknown): ProviderContext => ({
  fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch,
})

describe('mapOpenverseLicense', () => {
  it('maps cc0/pdm and all six CC families faithfully; bespoke sampling deeds stay proprietary', () => {
    expect(mapOpenverseLicense('cc0')).toBe('CC0-1.0')
    expect(mapOpenverseLicense('pdm')).toBe('PD')
    expect(mapOpenverseLicense('by')).toBe('CC-BY')
    expect(mapOpenverseLicense('by-sa')).toBe('CC-BY-SA')
    expect(mapOpenverseLicense('by-nc-nd')).toBe('CC-BY-NC-ND')
    expect(mapOpenverseLicense('by-nc')).toBe('CC-BY-NC')
    expect(mapOpenverseLicense('by-nc-sa')).toBe('CC-BY-NC-SA')
    expect(mapOpenverseLicense('by-nd')).toBe('CC-BY-ND')
    expect(mapOpenverseLicense('sampling+')).toBe('proprietary')
    expect(mapOpenverseLicense('nc-sampling+')).toBe('proprietary')
    expect(mapOpenverseLicense('whatever')).toBe('unknown')
  })
})

describe('openverse provider', () => {
  it('preserves the default Openverse license_type when both unified flags are enabled', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse().search({
      text: 'sky',
      modalities: ['image'],
      controls: { license: { commercial: true, modification: true } },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('license_type')).toBe('commercial,modification')
  })

  it('maps allowUnknown license control to Openverse license_type=all', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse().search({
      text: 'sky',
      modalities: ['image'],
      controls: { license: { allowUnknown: true } },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('license_type')).toBe('all')
  })

  it('maps a single unified commercial license flag to Openverse license_type=commercial', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse().search({
      text: 'sky',
      modalities: ['image'],
      controls: { license: { commercial: true, modification: false } },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('license_type')).toBe('commercial')
  })

  it('forwards documented Openverse image search options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse().search({
      text: 'sky',
      modalities: ['image'],
      providerOptions: {
        source: ['flickr', 'rawpixel'],
        excludedSource: 'thingiverse',
        tags: ['blue', 'sky'],
        license: ['cc0', 'by'],
        licenseType: 'all-cc',
        filterDead: false,
        extension: ['jpg', 'png'],
        mature: true,
        sortBy: 'indexed_on',
        sortDir: 'desc',
        authority: true,
        authorityBoost: 2.5,
        includeSensitiveResults: true,
        category: ['photograph', 'illustration'],
        aspectRatio: 'wide',
        size: 'large',
        page: 3,
        pageSize: 17,
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('q')).toBeNull()
    expect(url.searchParams.get('source')).toBe('flickr,rawpixel')
    expect(url.searchParams.get('excluded_source')).toBe('thingiverse')
    expect(url.searchParams.get('tags')).toBe('blue,sky')
    expect(url.searchParams.get('license')).toBe('cc0,by')
    expect(url.searchParams.get('license_type')).toBe('all-cc')
    expect(url.searchParams.get('filter_dead')).toBe('false')
    expect(url.searchParams.get('extension')).toBe('jpg,png')
    expect(url.searchParams.get('mature')).toBe('true')
    expect(url.searchParams.get('unstable__sort_by')).toBe('indexed_on')
    expect(url.searchParams.get('unstable__sort_dir')).toBe('desc')
    expect(url.searchParams.get('unstable__authority')).toBe('true')
    expect(url.searchParams.get('unstable__authority_boost')).toBe('2.5')
    expect(url.searchParams.get('unstable__include_sensitive_results')).toBe('true')
    expect(url.searchParams.get('category')).toBe('photograph,illustration')
    expect(url.searchParams.get('aspect_ratio')).toBe('wide')
    expect(url.searchParams.get('size')).toBe('large')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('page_size')).toBe('17')
  })

  it('maps results to normalized References with correct provenance', async () => {
    const refs = await openverse().search({ text: 'sky', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(2)
    const cc0 = refs[0]
    expect(cc0.rights.license).toBe('CC0-1.0')
    expect(cc0.sourceUrl).toBe('https://ex/photo/aaa')
    expect(cc0.title).toBe('blue sky')
    expect(cc0.rights.author).toBe('Alice')
    expect(cc0.thumbnail?.url).toBe('https://api.openverse.org/v1/images/aaa/thumb/')
    expect(cc0.visual).toEqual({ width: 1024, height: 683 })
    expect(cc0.rights.rehostPolicy).toBe('cache-allowed')
    expect(cc0.rights.licenseVersion).toBeUndefined() // version only set for the CC-BY family
  })

  it('older CC-BY (e.g. 2.0) maps to the CC-BY family, version preserved, allowed-with-attribution', async () => {
    const OLDER_CC_FIXTURE = {
      results: [{
        id: 'ccc', title: 'forest', creator: 'Charlie', creator_url: 'https://ex/charlie',
        foreign_landing_url: 'https://ex/photo/ccc', url: 'https://cdn/ccc.jpg',
        thumbnail: 'https://api.openverse.org/v1/images/ccc/thumb/',
        width: 800, height: 600, license: 'by', license_version: '2.0',
        license_url: 'https://creativecommons.org/licenses/by/2.0/',
        attribution: '"forest" by Charlie is licensed under CC BY 2.0.',
      }],
    }
    const refs = await openverse().search({ text: 'x', modalities: ['image'] }, ctxWith(OLDER_CC_FIXTURE))
    const result = refs[0]
    expect(result.rights.license).toBe('CC-BY')
    expect(result.rights.licenseVersion).toBe('2.0')
    expect(evaluateUse(result.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('END-TO-END moat: a real by-nc-nd item keeps its family, version, and is denied for commercial use', async () => {
    const refs = await openverse().search({ text: 'sky', modalities: ['image'] }, ctxWith(FIXTURE))
    const ncnd = refs[1]
    expect(ncnd.rights.license).toBe('CC-BY-NC-ND')
    expect(ncnd.rights.licenseVersion).toBe('2.0')
    const verdict = evaluateUse(ncnd.rights, 'commercial-product')
    expect(verdict.decision).toBe('denied')
    expect(verdict.reasons.join(' ')).toContain('CC-BY-NC-ND')
    // ...while the cc0 item is allowed:
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('allowed')
  })

  it('passes provider conformance (testkit)', async () => {
    const refs = await searchConformant(openverse(), ctxWith(FIXTURE).fetch)
    expect(refs.length).toBeGreaterThan(0)
  })
})

describe('openverse anonymous page_size cap', () => {
  it('caps page_size at 20 for anonymous requests when limit exceeds it', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse().search({ text: 'sky', modalities: ['image'], limit: 24 }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('page_size')).toBe('20')
  })

  it('passes the requested limit through unchanged when under the anonymous cap', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse().search({ text: 'sky', modalities: ['image'], limit: 12 }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('page_size')).toBe('12')
  })

  it('caps page_size at 20 even when providerOptions.pageSize requests more, for anonymous requests', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse().search({
      text: 'sky',
      modalities: ['image'],
      providerOptions: { pageSize: 50 },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('page_size')).toBe('20')
  })

  it('does not cap page_size when a token is configured', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverse({ token: 't' }).search({ text: 'sky', modalities: ['image'], limit: 24 }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('page_size')).toBe('24')
  })
})

describe('openverseAudio provider', () => {
  // Shapes observed live on api.openverse.org/v1/audio/ (2026-10-12/13, keyless):
  // Freesound-sourced items carry category null, thumbnail null, bit_rate 128000,
  // sample_rate null and filetype mp3; Jamendo-sourced items carry category
  // "music", album art at /thumb/ (image/jpeg), bit_rate null and Jamendo's own
  // format code (mp32); Wikimedia-sourced items carry a sample rate, sometimes
  // category "pronunciation" and filetypes such as ogx. `duration` is in ms and
  // `waveform` (on every item) is JSON peak data, never an image.
  const FREESOUND_SOURCED = {
    id: 'a1', title: 'Piano Melody', creator: 'benpm',
    foreign_landing_url: 'https://freesound.org/people/benpm/sounds/186942',
    url: 'https://cdn.freesound.org/previews/186/186942_2594536-hq.mp3',
    thumbnail: null, license: 'by', license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    provider: 'freesound', source: 'freesound', category: null, genres: null,
    filetype: 'mp3', duration: 60116, bit_rate: 128000, sample_rate: null,
    waveform: 'https://api.openverse.org/v1/audio/a1/waveform/',
  }
  const JAMENDO_SOURCED = {
    id: 'a2', title: 'Ragtime Stroll', creator: 'fankel',
    foreign_landing_url: 'https://www.jamendo.com/track/1848357',
    url: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32',
    thumbnail: 'https://api.openverse.org/v1/audio/a2/thumb/', license: 'by-sa', license_version: '3.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    provider: 'jamendo', source: 'jamendo', category: 'music', genres: ['jazz', 'ragtime'],
    filetype: 'mp32', duration: 72000, bit_rate: null, sample_rate: null,
    waveform: 'https://api.openverse.org/v1/audio/a2/waveform/',
  }
  const WIKIMEDIA_SOURCED = {
    id: 'a3', title: 'De-Hallo.ogg', creator: 'Someone',
    foreign_landing_url: 'https://commons.wikimedia.org/w/index.php?curid=1',
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/1a/De-Hallo.ogx',
    thumbnail: null, license: 'by-sa', license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    provider: 'wikimedia_audio', source: 'wikimedia_audio', category: 'pronunciation', genres: null,
    filetype: 'ogx', duration: 1234, bit_rate: 112000, sample_rate: 44100,
    waveform: 'https://api.openverse.org/v1/audio/a3/waveform/',
  }
  const AUDIO = { results: [FREESOUND_SOURCED, JAMENDO_SOURCED, WIKIMEDIA_SOURCED] }

  it('maps audio to a Reference (modality audio, CC-BY + version, audio mime)', async () => {
    const refs = await openverseAudio().search({ text: 'piano', modalities: ['audio'] }, ctxWith(AUDIO))
    expect(refs).toHaveLength(3)
    const r = refs[0]
    expect(r.modality).toBe('audio')
    expect(r.rights.license).toBe('CC-BY')
    expect(r.rights.licenseVersion).toBe('4.0')
    expect(r.preview?.url).toBe('https://cdn.freesound.org/previews/186/186942_2594536-hq.mp3')
    expect(r.preview?.mediaType).toBe('audio/mpeg')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('fills audio metadata: duration ms → s, bit rate bps → kbps, format from filetype; null sample rate stays unset', async () => {
    const [freesoundItem] = await openverseAudio().search({ text: 'piano', modalities: ['audio'] }, ctxWith(AUDIO))
    expect(freesoundItem.audio).toEqual({ durationSec: 60.116, bitrateKbps: 128, format: 'mp3' })
  })

  it('normalises Jamendo format codes (mp31/mp32 → mp3) and leaves the null bit rate unset', async () => {
    const [, jamendoItem] = await openverseAudio().search({ text: 'piano', modalities: ['audio'] }, ctxWith(AUDIO))
    expect(jamendoItem.audio).toEqual({ durationSec: 72, format: 'mp3' })
    expect(jamendoItem.preview?.mediaType).toBe('audio/mpeg')
    const MP31 = { results: [{ ...JAMENDO_SOURCED, filetype: 'mp31' }] }
    const [mp31] = await openverseAudio().search({ text: 'x', modalities: ['audio'] }, ctxWith(MP31))
    expect(mp31.audio?.format).toBe('mp3')
  })

  it('keeps a sample rate when present; a filetype that is not a known audio format sets no format', async () => {
    const [, , wikimediaItem] = await openverseAudio().search({ text: 'hallo', modalities: ['audio'] }, ctxWith(AUDIO))
    expect(wikimediaItem.audio).toEqual({ durationSec: 1.234, bitrateKbps: 112, sampleRateHz: 44100 })
  })

  it('leaves audio unset when every upstream field is null', async () => {
    const BARE = { results: [{ ...FREESOUND_SOURCED, filetype: null, duration: null, bit_rate: null, sample_rate: null }] }
    const [r] = await openverseAudio().search({ text: 'x', modalities: ['audio'] }, ctxWith(BARE))
    expect(r.audio).toBeUndefined()
  })

  it('thumbnail is the upstream album art, never the JSON waveform; unset when the art is null', async () => {
    const [freesoundItem, jamendoItem] = await openverseAudio().search({ text: 'piano', modalities: ['audio'] }, ctxWith(AUDIO))
    expect(jamendoItem.thumbnail).toEqual({ url: 'https://api.openverse.org/v1/audio/a2/thumb/' })
    expect(freesoundItem.thumbnail).toBeUndefined()
  })

  it('maps category to kind only when it means music or a sound effect', async () => {
    const SFX = { results: [{ ...FREESOUND_SOURCED, category: 'sound_effect' }] }
    const [sfx] = await openverseAudio().search({ text: 'door', modalities: ['audio'] }, ctxWith(SFX))
    expect(sfx.kind).toBe('sound-effect')
    const [freesoundItem, jamendoItem, wikimediaItem] = await openverseAudio().search({ text: 'piano', modalities: ['audio'] }, ctxWith(AUDIO))
    expect(jamendoItem.kind).toBe('music')
    expect(freesoundItem.kind).toBeUndefined() // category null
    expect(wikimediaItem.kind).toBeUndefined() // 'pronunciation' is not a declared kind
  })

  it('passes provider conformance (testkit) on the audio fixture', async () => {
    const refs = await searchConformant(openverseAudio(), ctxWith(AUDIO).fetch)
    expect(refs).toHaveLength(3)
  })

  it('shares the license_type helper with audio searches', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverseAudio().search({
      text: 'piano',
      modalities: ['audio'],
      controls: { license: { allowUnknown: true } },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('license_type')).toBe('all')
  })

  it('forwards documented Openverse audio search options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverseAudio().search({
      text: 'piano',
      modalities: ['audio'],
      providerOptions: {
        creator: 'benpm',
        source: 'freesound',
        category: 'music',
        length: 'short',
        page: 2,
        pageSize: 9,
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('q')).toBeNull()
    expect(url.searchParams.get('creator')).toBe('benpm')
    expect(url.searchParams.get('source')).toBe('freesound')
    expect(url.searchParams.get('category')).toBe('music')
    expect(url.searchParams.get('length')).toBe('short')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('9')
    expect(url.searchParams.get('aspect_ratio')).toBeNull()
    expect(url.searchParams.get('size')).toBeNull()
  })

  it('a by-nc audio item keeps its family and version, still denied for commercial use (moat)', async () => {
    const NC = { results: [{ ...AUDIO.results[0], license: 'by-nc', license_version: '3.0' }] }
    const refs = await openverseAudio().search({ text: 'x', modalities: ['audio'] }, ctxWith(NC))
    expect(refs[0].rights.license).toBe('CC-BY-NC')
    expect(refs[0].rights.licenseVersion).toBe('3.0')
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('denied')
  })

  it('declares a description but no kinds (omnibus source) for images', () => {
    const p = openverse()
    expect(p.kinds).toBeUndefined()
    expect(p.description).toBeTruthy()
  })

  it('declares kinds and description for audio', () => {
    expect(openverseAudio().id).toBe('openverse-audio')
    expect(openverseAudio().kinds).toEqual(['music', 'sound-effect'])
  })

  it('caps page_size at 20 for anonymous audio requests when limit exceeds it', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await openverseAudio().search({ text: 'piano', modalities: ['audio'], limit: 24 }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('page_size')).toBe('20')
  })
})
