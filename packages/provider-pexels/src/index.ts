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
  avg_color: string
  alt: string
  src: { tiny: string; medium: string; original: string }
}
interface PexelsResponse { photos: PexelsPhoto[] }

function toReference(p: PexelsPhoto): Reference {
  const rights: RightsRecord = {
    license: 'pexels',
    author: p.photographer,
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
