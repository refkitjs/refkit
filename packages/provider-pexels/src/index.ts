import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface PexelsConfig { apiKey: string }

interface PexelsPhoto {
  id: number
  width: number
  height: number
  url: string
  photographer: string
  photographer_url: string
  avg_color: string | null
  alt: string
  src: { tiny: string; medium: string; original: string }
}
interface PexelsResponse { photos: PexelsPhoto[] }

function toReference(p: PexelsPhoto): Reference {
  const rights: RightsRecord = {
    license: 'pexels',
    author: p.photographer,
    // conservative: Pexels ToS forbids redistributing the asset as a download; serve via the pexels CDN url + link back
    rehostPolicy: 'hotlink-required',
    raw: { sourceTerms: 'https://www.pexels.com/license/', sourceUrl: p.url },
  }
  return {
    id: referenceId('pexels', p.url),
    modality: 'image',
    title: p.alt || undefined,
    source: { providerId: 'pexels', sourceUrl: p.url },
    canonicalUrl: p.url,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: p.src.tiny },
    visual: { width: p.width, height: p.height, dominantColors: p.avg_color ? [p.avg_color] : undefined },
    relevance: 0,
    raw: p,
  }
}

export function pexels(config: PexelsConfig) {
  return defineProvider({
    id: 'pexels',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.pexels.com/v1/search')
      url.searchParams.set('query', q.text)
      url.searchParams.set('per_page', String(Math.min(q.limit ?? 15, 80)))
      const res = await ctx.fetch(url.toString(), { headers: { Authorization: config.apiKey }, signal: ctx.signal })
      if (!res.ok) throw new Error(`pexels search failed: ${res.status}`)
      const json = (await res.json()) as PexelsResponse
      return json.photos.map(toReference)
    },
  })
}

interface PexelsVideoFile { quality: string; file_type: string; width: number | null; height: number | null; link: string }
interface PexelsVideo {
  id: number
  width: number
  height: number
  url: string
  duration: number
  image: string
  user: { name: string; url: string }
  video_files: PexelsVideoFile[]
}
interface PexelsVideoResponse { videos: PexelsVideo[] }

// Prefer an HD rendition; fall back to the first available file.
function pickVideoFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  return files.find((f) => f.quality === 'hd') ?? files[0]
}

function toVideoReference(v: PexelsVideo): Reference {
  const file = pickVideoFile(v.video_files ?? [])
  const rights: RightsRecord = {
    license: 'pexels',
    author: v.user?.name,
    rehostPolicy: 'hotlink-required',
    raw: { sourceTerms: 'https://www.pexels.com/license/', sourceUrl: v.url },
  }
  return {
    id: referenceId('pexels-video', v.url),
    modality: 'video',
    source: { providerId: 'pexels-video', sourceUrl: v.url },
    canonicalUrl: v.url,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: v.image },
    ...(file ? { preview: { url: file.link, mediaType: file.file_type || 'video/mp4', width: file.width ?? undefined, height: file.height ?? undefined } } : {}),
    visual: { width: v.width, height: v.height },
    relevance: 0,
    raw: v,
  }
}

// Pexels' video catalogue under the same key — the cheap video leg.
export function pexelsVideo(config: PexelsConfig) {
  return defineProvider({
    id: 'pexels-video',
    modalities: ['video'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.pexels.com/videos/search')
      url.searchParams.set('query', q.text)
      url.searchParams.set('per_page', String(Math.min(q.limit ?? 15, 80)))
      const res = await ctx.fetch(url.toString(), { headers: { Authorization: config.apiKey }, signal: ctx.signal })
      if (!res.ok) throw new Error(`pexels video search failed: ${res.status}`)
      const json = (await res.json()) as PexelsVideoResponse
      return json.videos.map(toVideoReference)
    },
  })
}
