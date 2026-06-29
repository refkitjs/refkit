import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { ambientcg } from '../index'

const ctxJson = (body: unknown, capture?: (u: string) => void): ProviderContext => ({
  fetch: (async (input: string) => {
    capture?.(String(input))
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch,
})

const FOUND = {
  foundAssets: [
    {
      assetId: 'Tiles141', displayName: 'Tiles 141', dataType: 'Material',
      category: 'Tiles', tags: ['tiles', 'floor'],
      previewImage: {
        '256-PNG': 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Tiles141.png',
        '512-PNG': 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-PNG/Tiles141.png',
      },
    },
  ],
}
const FOUND_NO_IMAGE = {
  foundAssets: [
    // a non-image asset (e.g. plugin/3D-only) with no previewImage → must not be emitted (D1)
    { assetId: 'SomeModel', displayName: 'Some Model', dataType: '3DModel', tags: [] },
  ],
}

describe('ambientcg provider', () => {
  it('maps a Material to a CC0 image reference using the PNG preview', async () => {
    let url = ''
    const refs = await ambientcg().search(
      { text: 'tiles', modalities: ['image'], limit: 5 },
      ctxJson(FOUND, (u) => { url = u }),
    )
    expect(url).toContain('type=Material')
    expect(url).toContain('q=tiles')
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.title).toBe('Tiles 141')
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
    expect(r.rights.raw.sourceTerms).toBe('https://ambientcg.com/license/')
    expect(r.preview?.url).toContain('512-PNG/Tiles141.png')
    expect(r.canonicalUrl).toBe('https://ambientcg.com/view?id=Tiles141')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('drops assets without an image preview (non-image dataType, D1)', async () => {
    const refs = await ambientcg().search({ text: 'x', modalities: ['image'] }, ctxJson(FOUND_NO_IMAGE))
    expect(refs).toEqual([])
  })
})
