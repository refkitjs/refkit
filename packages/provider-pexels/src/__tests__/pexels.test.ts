import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { pexels, pexelsVideo } from '../index'

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

  it('forwards documented photo search filters and Pexels-specific options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify(FIXTURE), { status: 200 })
      }) as typeof fetch,
    }
    await pexels({ apiKey: 'k' }).search({
      text: 'trees',
      modalities: ['image'],
      filters: { orientation: 'portrait', color: '#ffffff', language: 'zh-CN' },
      providerOptions: { size: 'large', page: 2 },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('orientation')).toBe('portrait')
    expect(url.searchParams.get('color')).toBe('#ffffff')
    expect(url.searchParams.get('locale')).toBe('zh-CN')
    expect(url.searchParams.get('size')).toBe('large')
    expect(url.searchParams.get('page')).toBe('2')
  })
})

describe('pexelsVideo provider', () => {
  const VIDEO_FIXTURE = {
    videos: [{
      id: 6394054, width: 2560, height: 1440,
      url: 'https://www.pexels.com/video/a-cat-6394054/', duration: 12,
      image: 'https://images.pexels.com/videos/6394054/cat.jpg',
      user: { name: 'Cottonbro', url: 'https://www.pexels.com/@cottonbro' },
      video_files: [
        { quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, link: 'https://player.vimeo.com/x-sd.mp4' },
        { quality: 'hd', file_type: 'video/mp4', width: 1280, height: 720, link: 'https://player.vimeo.com/x-hd.mp4' },
      ],
    }],
  }

  it('maps a video (license pexels, modality video, HD file preferred, thumbnail from image)', async () => {
    const refs = await pexelsVideo({ apiKey: 'k' }).search({ text: 'cat', modalities: ['video'] }, ctxWith(VIDEO_FIXTURE))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('video')
    expect(r.source.providerId).toBe('pexels-video')
    expect(r.rights.license).toBe('pexels')
    expect(r.canonicalUrl).toBe('https://www.pexels.com/video/a-cat-6394054/')
    expect(r.rights.author).toBe('Cottonbro')
    expect(r.preview?.url).toBe('https://player.vimeo.com/x-hd.mp4') // HD preferred over SD
    expect(r.preview?.mediaType).toBe('video/mp4')
    expect(r.thumbnail?.url).toBe('https://images.pexels.com/videos/6394054/cat.jpg')
    expect(r.visual).toEqual({ width: 2560, height: 1440 })
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed') // pexels license is commercial-OK
  })

  it('forwards documented video search filters and Pexels-specific options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify(VIDEO_FIXTURE), { status: 200 })
      }) as typeof fetch,
    }
    await pexelsVideo({ apiKey: 'k' }).search({
      text: 'cat',
      modalities: ['video'],
      filters: { orientation: 'landscape', language: 'en-US' },
      providerOptions: { size: 'medium', page: 3 },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('orientation')).toBe('landscape')
    expect(url.searchParams.get('locale')).toBe('en-US')
    expect(url.searchParams.get('size')).toBe('medium')
    expect(url.searchParams.get('page')).toBe('3')
  })
})
