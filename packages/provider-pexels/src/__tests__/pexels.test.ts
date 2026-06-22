import { describe, expect, it } from 'vitest'
import type { ProviderContext } from '@refkit/core'
import { pexels } from '../index'

const FIXTURE = {
  total_results: 10000, page: 1, per_page: 1,
  photos: [{
    id: 3573351, width: 3066, height: 3968,
    url: 'https://www.pexels.com/photo/trees-3573351/',
    photographer: 'Lukas Rodriguez', photographer_url: 'https://www.pexels.com/@lukas-1845331',
    avg_color: '#374824',
    src: { tiny: 'https://images.pexels.com/photos/3573351/x?h=200', medium: 'https://images.pexels.com/photos/3573351/x?h=350', original: 'https://images.pexels.com/photos/3573351/x.png' },
    alt: 'Brown Rocks During Golden Hour',
  }],
}
const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

describe('pexels provider', () => {
  it('maps a photo (license pexels, hotlink-required, numeric id handled)', async () => {
    const refs = await pexels({ apiKey: 'k' }).search({ text: 'trees', modalities: ['image'] }, ctxWith(FIXTURE))
    const r = refs[0]
    expect(r.rights.license).toBe('pexels')
    expect(r.rights.rehostPolicy).toBe('hotlink-required')
    expect(r.id).toMatch(/^pexels:/)
    expect(r.canonicalUrl).toBe('https://www.pexels.com/photo/trees-3573351/')
    expect(r.rights.author).toBe('Lukas Rodriguez')
    expect(r.title).toBe('Brown Rocks During Golden Hour')
    expect(r.thumbnail?.url).toBe('https://images.pexels.com/photos/3573351/x?h=200')
    expect(r.visual).toEqual({ width: 3066, height: 3968, dominantColors: ['#374824'] })
  })
})
