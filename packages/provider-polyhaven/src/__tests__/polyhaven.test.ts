import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { polyhaven } from '../index'

// Poly Haven: /assets returns id→asset (no URLs); /files/<id> returns the download tree.
const ctxRouting = (list: unknown, files: Record<string, unknown>): ProviderContext => ({
  fetch: (async (input: string) => {
    const u = String(input)
    if (u.includes('/assets')) return new Response(JSON.stringify(list), { status: 200 })
    const m = u.match(/\/files\/([^/?]+)/)
    if (m && files[m[1]]) return new Response(JSON.stringify(files[m[1]]), { status: 200 })
    return new Response('null', { status: 404 })
  }) as typeof fetch,
})

const LIST = {
  aerial_asphalt_01: {
    type: 1, name: 'Aerial Asphalt 01', categories: ['asphalt', 'road'], tags: ['flat'],
    authors: { 'Rob Tuytel': 'All' },
    thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/aerial_asphalt_01.png?width=256&height=256',
  },
}
const FILES_TEX = {
  aerial_asphalt_01: {
    Diffuse: {
      '1k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_asphalt_01/aerial_asphalt_01_diff_1k.jpg' } },
    },
    // non-image keys that must be ignored:
    blend: { '1k': { blend: { url: 'https://dl.polyhaven.org/x.blend' } } },
    gltf: { '1k': { gltf: { url: 'https://dl.polyhaven.org/x.gltf' } } },
  },
}

describe('polyhaven provider', () => {
  it('maps a texture to a CC0 image reference with a resolved jpg preview', async () => {
    const refs = await polyhaven().search(
      { text: 'asphalt', modalities: ['image'], limit: 5 },
      ctxRouting(LIST, FILES_TEX),
    )
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.title).toBe('Aerial Asphalt 01')
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.author).toBe('Rob Tuytel')
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
    expect(r.rights.raw.sourceTerms).toBe('https://polyhaven.com/license')
    expect(r.preview?.url).toContain('aerial_asphalt_01_diff_1k.jpg')
    expect(r.preview?.mediaType).toBe('image/jpeg')
    expect(r.thumbnail?.url).toContain('thumbs/aerial_asphalt_01.png')
    expect(r.canonicalUrl).toBe('https://polyhaven.com/a/aerial_asphalt_01')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('returns [] when the list is empty', async () => {
    const refs = await polyhaven().search({ text: 'zzz', modalities: ['image'] }, ctxRouting({}, {}))
    expect(refs).toEqual([])
  })
})
