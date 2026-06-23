import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface PixabayConfig { key: string }

interface PixabayHit {
  id: number
  tags: string
  user: string
  pageURL: string
  previewURL: string
  previewWidth: number
  previewHeight: number
  webformatURL: string
  largeImageURL: string
  imageWidth: number
  imageHeight: number
}
interface PixabayResponse { hits: PixabayHit[] }

function toReference(h: PixabayHit): Reference {
  const rights: RightsRecord = {
    license: 'pixabay',
    author: h.user,
    rehostPolicy: 'cache-allowed', // Pixabay forbids hotlinking; webformatURL valid 24h → must cache
    raw: { sourceTerms: 'https://pixabay.com/service/license-summary/', sourceUrl: h.pageURL },
  }
  return {
    id: referenceId('pixabay', h.pageURL),
    modality: 'image',
    title: h.tags || undefined, // no title field; tags is the only descriptive text
    source: { providerId: 'pixabay', sourceUrl: h.pageURL },
    canonicalUrl: h.pageURL,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: h.previewURL, width: h.previewWidth, height: h.previewHeight },
    visual: { width: h.imageWidth, height: h.imageHeight },
    relevance: 0,
    raw: h,
  }
}

export function pixabay(config: PixabayConfig) {
  return defineProvider({
    id: 'pixabay',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://pixabay.com/api/')
      url.searchParams.set('key', config.key)
      url.searchParams.set('q', q.text)
      url.searchParams.set('image_type', 'photo')
      url.searchParams.set('per_page', String(Math.min(Math.max(q.limit ?? 20, 3), 200)))
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`pixabay search failed: ${res.status}`)
      const json = (await res.json()) as PixabayResponse
      return json.hits.map(toReference)
    },
  })
}

interface PixabayVideoSize { url: string; width: number; height: number; size: number; thumbnail?: string }
interface PixabayVideoHit {
  id: number
  pageURL: string
  tags: string
  duration: number
  user: string
  videos: { large?: PixabayVideoSize; medium?: PixabayVideoSize; small?: PixabayVideoSize; tiny?: PixabayVideoSize }
}
interface PixabayVideoResponse { hits: PixabayVideoHit[] }

function toVideoReference(h: PixabayVideoHit): Reference {
  const v = h.videos.large ?? h.videos.medium ?? h.videos.small ?? h.videos.tiny
  const rights: RightsRecord = {
    license: 'pixabay',
    author: h.user,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://pixabay.com/service/license-summary/', sourceUrl: h.pageURL },
  }
  return {
    id: referenceId('pixabay-video', h.pageURL),
    modality: 'video',
    title: h.tags || undefined,
    source: { providerId: 'pixabay-video', sourceUrl: h.pageURL },
    canonicalUrl: h.pageURL,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(v?.thumbnail ? { thumbnail: { url: v.thumbnail } } : {}),
    ...(v ? { preview: { url: v.url, mediaType: 'video/mp4', width: v.width, height: v.height }, visual: { width: v.width, height: v.height } } : {}),
    relevance: 0,
    raw: h,
  }
}

// Pixabay's video catalogue under the same key — the cheap video leg.
export function pixabayVideo(config: PixabayConfig) {
  return defineProvider({
    id: 'pixabay-video',
    modalities: ['video'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://pixabay.com/api/videos/')
      url.searchParams.set('key', config.key)
      url.searchParams.set('q', q.text)
      url.searchParams.set('per_page', String(Math.min(Math.max(q.limit ?? 20, 3), 200)))
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`pixabay video search failed: ${res.status}`)
      const json = (await res.json()) as PixabayVideoResponse
      return json.hits.map(toVideoReference)
    },
  })
}
