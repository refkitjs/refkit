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
  // Three more assets so a multi-word query can match per token and rank by how
  // many of them a single asset covers.
  forest_floor: { type: 1, name: 'Forest Floor', tags: ['forest', 'ground'] },
  brick_wall: { type: 1, name: 'Brick Wall', tags: ['brick'] },
  mossy_forest_rock: { type: 1, name: 'Mossy Forest Rock', tags: ['forest', 'rock', 'moss'] },
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
  forest_floor: { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/forest_floor_diff_1k.jpg' } } } },
  brick_wall: { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/brick_wall_diff_1k.jpg' } } } },
  mossy_forest_rock: { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/mossy_forest_rock_diff_1k.jpg' } } } },
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
    expect(r.tags).toEqual(['asphalt', 'road', 'flat']) // categories then tags
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.author).toBe('Rob Tuytel')
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
    expect(r.rights.raw.sourceTerms).toBe('https://polyhaven.com/license')
    expect(r.preview?.url).toContain('aerial_asphalt_01_diff_1k.jpg')
    expect(r.preview?.mediaType).toBe('image/jpeg')
    expect(r.thumbnail?.url).toContain('thumbs/aerial_asphalt_01.png')
    expect(r.sourceUrl).toBe('https://polyhaven.com/a/aerial_asphalt_01')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('returns [] when the list is empty', async () => {
    const refs = await polyhaven().search({ text: 'zzz', modalities: ['image'] }, ctxRouting({}, {}))
    expect(refs).toEqual([])
  })

  it('matches each query token independently and ranks by matched tokens', async () => {
    const refs = await polyhaven().search({ text: 'forest rock', modalities: ['image'] }, ctxRouting(LIST, FILES_TEX))
    expect(refs.map(r => r.sourceUrl)).toEqual(['https://polyhaven.com/a/mossy_forest_rock', 'https://polyhaven.com/a/forest_floor'])
  })

  it('tokenises on punctuation, not just whitespace — "forest, rock." matches the same assets as "forest rock"', async () => {
    const [withPunctuation, withSpace] = await Promise.all([
      polyhaven().search({ text: 'forest, rock.', modalities: ['image'] }, ctxRouting(LIST, FILES_TEX)),
      polyhaven().search({ text: 'forest rock', modalities: ['image'] }, ctxRouting(LIST, FILES_TEX)),
    ])
    expect(withPunctuation.map(r => r.sourceUrl)).toEqual(withSpace.map(r => r.sourceUrl))
  })

  it('declares kinds per assetType', () => {
    expect(polyhaven().kinds).toEqual(['texture'])
    expect(polyhaven({ assetType: 'hdris' }).kinds).toEqual(['hdri'])
  })
})
