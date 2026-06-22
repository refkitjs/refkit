import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface UnsplashConfig { accessKey: string }

interface UnsplashResult {
  id: string
  description: string | null
  alt_description: string | null
  width: number
  height: number
  color: string | null
  user: { name: string; links: { html: string } }
  urls: { thumb: string; small: string; regular: string }
  links: { html: string; download_location: string }
}
interface UnsplashResponse { results: UnsplashResult[] }

function toReference(r: UnsplashResult): Reference {
  const rights: RightsRecord = {
    license: 'unsplash',
    author: r.user.name,
    rehostPolicy: 'hotlink-required',
    raw: { sourceTerms: 'https://unsplash.com/license', sourceUrl: r.links.html },
  }
  return {
    id: referenceId('unsplash', r.links.html),
    modality: 'image',
    title: r.description ?? r.alt_description ?? undefined,
    source: { providerId: 'unsplash', sourceUrl: r.links.html },
    canonicalUrl: r.links.html,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: r.urls.thumb },
    visual: { width: r.width, height: r.height, dominantColors: r.color ? [r.color] : undefined },
    relevance: 0,
    raw: r, // carries links.download_location — host fires it on use (Unsplash ToS)
  }
}

export function unsplash(config: UnsplashConfig) {
  return defineProvider({
    id: 'unsplash',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.unsplash.com/search/photos')
      url.searchParams.set('query', q.text)
      url.searchParams.set('per_page', String(Math.min(q.limit ?? 10, 30)))
      const res = await ctx.fetch(url.toString(), {
        headers: { Authorization: `Client-ID ${config.accessKey}`, 'Accept-Version': 'v1' },
        signal: ctx.signal,
      })
      if (!res.ok) throw new Error(`unsplash search failed: ${res.status}`)
      const json = (await res.json()) as UnsplashResponse
      return json.results.map(toReference)
    },
  })
}
