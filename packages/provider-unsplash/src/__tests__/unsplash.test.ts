import { describe, expect, it } from 'vitest'
import type { ProviderContext } from '@refkit/core'
import { unsplash } from '../index'

const FIXTURE = {
  total: 133, total_pages: 7,
  results: [{
    id: 'eOLpJytrbsQ', width: 4000, height: 3000, color: '#A7A2A1',
    description: 'A man drinking a coffee.', alt_description: null,
    user: { name: 'Jeff Sheldon', links: { html: 'http://unsplash.com/@ugmonk' } },
    urls: { thumb: 'https://images.unsplash.com/photo-1?w=200', small: 'https://images.unsplash.com/photo-1?w=400', regular: 'https://images.unsplash.com/photo-1?w=1080' },
    links: { html: 'http://unsplash.com/photos/eOLpJytrbsQ', download_location: 'https://api.unsplash.com/photos/eOLpJytrbsQ/download' },
  }],
}
const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

describe('unsplash provider', () => {
  it('maps a photo to a normalized Reference (license unsplash, hotlink-required)', async () => {
    const refs = await unsplash({ accessKey: 'k' }).search({ text: 'coffee', modalities: ['image'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.rights.license).toBe('unsplash')
    expect(r.rights.rehostPolicy).toBe('hotlink-required')
    expect(r.rights.author).toBe('Jeff Sheldon')
    expect(r.canonicalUrl).toBe('http://unsplash.com/photos/eOLpJytrbsQ')
    expect(r.title).toBe('A man drinking a coffee.')
    expect(r.thumbnail?.url).toBe('https://images.unsplash.com/photo-1?w=200')
    expect(r.visual).toEqual({ width: 4000, height: 3000, dominantColors: ['#A7A2A1'] })
    // download_location is carried in raw for the host to fire on use (ToS):
    expect((r.raw as { links: { download_location: string } }).links.download_location)
      .toBe('https://api.unsplash.com/photos/eOLpJytrbsQ/download')
  })

  it('falls back description -> alt_description -> undefined for title', async () => {
    const f = { ...FIXTURE, results: [{ ...FIXTURE.results[0], description: null, alt_description: 'coffee cup' }] }
    const refs = await unsplash({ accessKey: 'k' }).search({ text: 'x', modalities: ['image'] }, ctxWith(f))
    expect(refs[0].title).toBe('coffee cup')
  })
})
