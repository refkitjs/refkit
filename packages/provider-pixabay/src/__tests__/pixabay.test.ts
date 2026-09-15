import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
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
    expect(r.sourceUrl).toBe('https://pixabay.com/en/blossom-bloom-flower-195893/')
    expect(r.title).toBe('blossom, bloom, flower')
    expect(r.tags).toEqual(['blossom', 'bloom', 'flower']) // the comma-separated string, split
    expect(r.rights.author).toBe('Josch13')
    expect(r.thumbnail).toEqual({ url: 'https://cdn.pixabay.com/photo/flower-195893_150.jpg', width: 150, height: 84 })
    expect(r.visual).toEqual({ width: 4000, height: 2250 })
  })

  it('forwards documented image search controls and Pixabay-specific options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => { calledUrl = String(input); return new Response(JSON.stringify(FIXTURE), { status: 200 }) }) as typeof fetch,
    }
    await pixabay({ key: 'SECRET' }).search({
      text: 'flowers',
      modalities: ['image'],
      controls: { orientation: 'landscape', color: 'blue', language: 'de' },
      providerOptions: {
        imageType: 'illustration',
        orientation: 'vertical',
        category: 'nature',
        minWidth: 1200,
        minHeight: 800,
        colors: ['blue', 'transparent'],
        safesearch: true,
        order: 'latest',
        editorsChoice: true,
        lang: 'fr',
        id: '195893',
        page: 4,
        perPage: 33,
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('orientation')).toBe('vertical')
    expect(url.searchParams.get('colors')).toBe('blue,transparent')
    expect(url.searchParams.get('lang')).toBe('fr')
    expect(url.searchParams.get('id')).toBe('195893')
    expect(url.searchParams.get('image_type')).toBe('illustration')
    expect(url.searchParams.get('category')).toBe('nature')
    expect(url.searchParams.get('min_width')).toBe('1200')
    expect(url.searchParams.get('min_height')).toBe('800')
    expect(url.searchParams.get('safesearch')).toBe('true')
    expect(url.searchParams.get('order')).toBe('latest')
    expect(url.searchParams.get('editors_choice')).toBe('true')
    expect(url.searchParams.get('page')).toBe('4')
    expect(url.searchParams.get('per_page')).toBe('33')
  })

  it('maps unified controls to documented Pixabay image search params', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => { calledUrl = String(input); return new Response(JSON.stringify(FIXTURE), { status: 200 }) }) as typeof fetch,
    }
    await pixabay({ key: 'SECRET' }).search({
      text: 'flowers',
      modalities: ['image'],
      controls: {
        orientation: 'landscape',
        color: 'blue',
        language: 'de',
        sort: 'latest',
        safety: 'strict',
        media: { kind: 'illustration', minWidth: 1200, minHeight: 800 },
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('orientation')).toBe('horizontal')
    expect(url.searchParams.get('colors')).toBe('blue')
    expect(url.searchParams.get('lang')).toBe('de')
    expect(url.searchParams.get('image_type')).toBe('illustration')
    expect(url.searchParams.get('min_width')).toBe('1200')
    expect(url.searchParams.get('min_height')).toBe('800')
    expect(url.searchParams.get('safesearch')).toBe('true')
    expect(url.searchParams.get('order')).toBe('latest')
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
    expect(r.rights.license).toBe('pixabay')
    expect(r.title).toBe('flowers, meadow')
    expect(r.tags).toEqual(['flowers', 'meadow'])
    expect(r.preview?.url).toBe('https://cdn.pixabay.com/vimeo/125/large.mp4')
    expect(r.thumbnail?.url).toBe('https://cdn.pixabay.com/vimeo/125/large.jpg')
    expect(r.visual).toEqual({ width: 1920, height: 1080 })
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed') // pixabay license is commercial-OK
  })

  it('forwards documented video search controls and Pixabay-specific options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => { calledUrl = String(input); return new Response(JSON.stringify(VIDEO_FIXTURE), { status: 200 }) }) as typeof fetch,
    }
    await pixabayVideo({ key: 'SECRET' }).search({
      text: 'flowers',
      modalities: ['video'],
      controls: { language: 'fr' },
      providerOptions: {
        videoType: 'animation',
        category: 'education',
        minWidth: 1920,
        minHeight: 1080,
        safesearch: true,
        order: 'latest',
        editorsChoice: true,
        lang: 'de',
        id: '125',
        page: 5,
        perPage: 44,
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('lang')).toBe('de')
    expect(url.searchParams.get('id')).toBe('125')
    expect(url.searchParams.get('video_type')).toBe('animation')
    expect(url.searchParams.get('category')).toBe('education')
    expect(url.searchParams.get('min_width')).toBe('1920')
    expect(url.searchParams.get('min_height')).toBe('1080')
    expect(url.searchParams.get('safesearch')).toBe('true')
    expect(url.searchParams.get('order')).toBe('latest')
    expect(url.searchParams.get('editors_choice')).toBe('true')
    expect(url.searchParams.get('page')).toBe('5')
    expect(url.searchParams.get('per_page')).toBe('44')
  })

  it('declares kinds and description (image + video factories)', () => {
    expect(pixabay({ key: 'k' }).id).toBe('pixabay')
    expect(pixabay({ key: 'k' }).kinds).toEqual(['photo', 'illustration', 'vector'])
    expect(pixabayVideo({ key: 'k' }).id).toBe('pixabay-video')
    expect(pixabayVideo({ key: 'k' }).kinds).toEqual(['film', 'animation'])
  })

  it('maps the upstream hit type to Reference.kind', async () => {
    const hit = {
      id: 1, tags: 'x', user: 'u', pageURL: 'https://pixabay.com/p/1',
      previewURL: 'https://cdn/p.jpg', previewWidth: 10, previewHeight: 10,
      webformatURL: 'https://cdn/w.jpg', largeImageURL: 'https://cdn/l.jpg',
      imageWidth: 100, imageHeight: 100, type: 'vectors/svg',
    }
    const fakeFetch = (async () => new Response(JSON.stringify({ hits: [hit] }), { status: 200 })) as typeof fetch
    const refs = await pixabay({ key: 'k' }).search({ text: 'x', modalities: ['image'] }, { fetch: fakeFetch })
    expect(refs[0].kind).toBe('vector')
  })
})
