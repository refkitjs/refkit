import { describe, expect, it } from 'vitest'
import type { ProviderContext } from '@refkit/core'
import { pixabay, pixabayVideo } from '../index'

const FIXTURE = {
  total: 4692, totalHits: 500,
  hits: [{
    id: 195893, pageURL: 'https://pixabay.com/en/blossom-bloom-flower-195893/', type: 'photo',
    tags: 'blossom, bloom, flower',
    previewURL: 'https://cdn.pixabay.com/photo/flower-195893_150.jpg', previewWidth: 150, previewHeight: 84,
    webformatURL: 'https://pixabay.com/get/x_640.jpg', webformatWidth: 640, webformatHeight: 360,
    largeImageURL: 'https://pixabay.com/get/x_1280.jpg',
    imageWidth: 4000, imageHeight: 2250, user_id: 48777, user: 'Josch13',
  }],
}

describe('pixabay provider', () => {
  it('maps a hit (license pixabay, cache-allowed, tags as title, thumb dims, key in query)', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => { calledUrl = String(input); return new Response(JSON.stringify(FIXTURE), { status: 200 }) }) as typeof fetch,
    }
    const refs = await pixabay({ key: 'SECRET' }).search({ text: 'flowers', modalities: ['image'] }, ctx)
    const r = refs[0]
    expect(calledUrl).toContain('key=SECRET')
    expect(r.rights.license).toBe('pixabay')
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
    expect(r.canonicalUrl).toBe('https://pixabay.com/en/blossom-bloom-flower-195893/')
    expect(r.title).toBe('blossom, bloom, flower')
    expect(r.rights.author).toBe('Josch13')
    expect(r.thumbnail).toEqual({ url: 'https://cdn.pixabay.com/photo/flower-195893_150.jpg', width: 150, height: 84 })
    expect(r.visual).toEqual({ width: 4000, height: 2250 })
  })
})

describe('pixabayVideo provider', () => {
  const VIDEO_FIXTURE = {
    total: 100, totalHits: 50,
    hits: [{
      id: 125, pageURL: 'https://pixabay.com/videos/id-125/', type: 'film', tags: 'flowers, meadow', duration: 13, user: 'CoverrFree',
      videos: {
        large: { url: 'https://cdn.pixabay.com/vimeo/125/large.mp4', width: 1920, height: 1080, size: 6000000, thumbnail: 'https://cdn.pixabay.com/vimeo/125/large.jpg' },
        small: { url: 'https://cdn.pixabay.com/vimeo/125/small.mp4', width: 960, height: 540, size: 2000000, thumbnail: 'https://cdn.pixabay.com/vimeo/125/small.jpg' },
      },
    }],
  }

  it('maps a video (license pixabay, modality video, large rendition, key in query)', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => { calledUrl = String(input); return new Response(JSON.stringify(VIDEO_FIXTURE), { status: 200 }) }) as typeof fetch,
    }
    const refs = await pixabayVideo({ key: 'SECRET' }).search({ text: 'flowers', modalities: ['video'] }, ctx)
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(calledUrl).toContain('https://pixabay.com/api/videos/')
    expect(calledUrl).toContain('key=SECRET')
    expect(r.modality).toBe('video')
    expect(r.source.providerId).toBe('pixabay-video')
    expect(r.rights.license).toBe('pixabay')
    expect(r.title).toBe('flowers, meadow')
    expect(r.preview?.url).toBe('https://cdn.pixabay.com/vimeo/125/large.mp4')
    expect(r.thumbnail?.url).toBe('https://cdn.pixabay.com/vimeo/125/large.jpg')
    expect(r.visual).toEqual({ width: 1920, height: 1080 })
  })
})
