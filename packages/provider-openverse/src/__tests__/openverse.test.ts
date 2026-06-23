import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { openverse, mapOpenverseLicense } from '../index'

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
  it('maps cc0/pdm and the BY/BY-SA family version-agnostically, NC/ND → proprietary', () => {
    expect(mapOpenverseLicense('cc0')).toBe('CC0-1.0')
    expect(mapOpenverseLicense('pdm')).toBe('PD')
    expect(mapOpenverseLicense('by')).toBe('CC-BY')
    expect(mapOpenverseLicense('by-sa')).toBe('CC-BY-SA')
    expect(mapOpenverseLicense('by-nc-nd')).toBe('proprietary')
    expect(mapOpenverseLicense('whatever')).toBe('unknown')
  })
})

describe('openverse provider', () => {
  it('maps results to normalized References with correct provenance', async () => {
    const refs = await openverse().search({ text: 'sky', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(2)
    const cc0 = refs[0]
    expect(cc0.rights.license).toBe('CC0-1.0')
    expect(cc0.canonicalUrl).toBe('https://ex/photo/aaa')
    expect(cc0.source).toEqual({ providerId: 'openverse', sourceUrl: 'https://ex/photo/aaa' })
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

  it('END-TO-END moat: a real by-nc-nd item maps to proprietary and is denied for commercial use', async () => {
    const refs = await openverse().search({ text: 'sky', modalities: ['image'] }, ctxWith(FIXTURE))
    const ncnd = refs[1]
    expect(ncnd.rights.license).toBe('proprietary')
    expect(evaluateUse(ncnd.rights, 'commercial-product').decision).toBe('denied')
    // ...while the cc0 item is allowed:
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('allowed')
  })
})
