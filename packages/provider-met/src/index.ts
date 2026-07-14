import {
  defineProvider, referenceId,
  setIfBoolean, setIfInt, setIfString,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface MetConfig {
  /** Max objects fetched per search. The Met search returns only IDs, so each
   *  result costs one extra call — this bounds that N+1 fan-out. Default 12. */
  maxObjects?: number
}

export interface MetSearchOptions {
  isHighlight?: boolean
  title?: boolean
  tags?: boolean
  departmentId?: number
  isOnView?: boolean
  artistOrCulture?: boolean
  medium?: string
  geoLocation?: string
  dateBegin?: number
  dateEnd?: number
}

const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1'

interface MetSearchResponse { total: number; objectIDs: number[] | null }
interface MetObject {
  objectID: number
  isPublicDomain: boolean
  primaryImage: string
  primaryImageSmall: string
  title: string
  artistDisplayName: string
  objectURL: string
  objectName: string
  medium: string
}

function toReference(o: MetObject): Reference | null {
  // The Met releases open-access (public-domain) images under CC0. Copyrighted
  // works return an empty primaryImage — nothing usable to surface.
  if (!o.isPublicDomain) return null
  const image = o.primaryImage || o.primaryImageSmall
  if (!image) return null
  const rights: RightsRecord = {
    license: 'CC0-1.0',
    author: o.artistDisplayName || undefined,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://www.metmuseum.org/information/terms-and-conditions', sourceUrl: o.objectURL },
  }
  return {
    id: referenceId('met', o.objectURL),
    modality: 'image',
    title: o.title || undefined,
    source: { providerId: 'met', sourceUrl: o.objectURL },
    canonicalUrl: o.objectURL,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(o.primaryImageSmall ? { thumbnail: { url: o.primaryImageSmall } } : {}),
    preview: { url: image, mediaType: 'image/jpeg' },
    relevance: 0,
    raw: o,
  }
}

export function met(config: MetConfig = {}) {
  return defineProvider({
    id: 'met',
    modalities: ['image'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const searchUrl = new URL(`${BASE}/search`)
      searchUrl.searchParams.set('q', q.text)
      searchUrl.searchParams.set('hasImages', 'true')
      const opts = q.providerOptions as MetSearchOptions | undefined
      setIfBoolean(searchUrl, 'isHighlight', opts?.isHighlight)
      setIfBoolean(searchUrl, 'title', opts?.title)
      setIfBoolean(searchUrl, 'tags', opts?.tags)
      setIfInt(searchUrl, 'departmentId', opts?.departmentId)
      setIfBoolean(searchUrl, 'isOnView', opts?.isOnView)
      setIfBoolean(searchUrl, 'artistOrCulture', opts?.artistOrCulture)
      setIfString(searchUrl, 'medium', opts?.medium)
      setIfString(searchUrl, 'geoLocation', opts?.geoLocation)
      setIfInt(searchUrl, 'dateBegin', opts?.dateBegin)
      setIfInt(searchUrl, 'dateEnd', opts?.dateEnd)
      const res = await ctx.fetch(searchUrl.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`met search failed: ${res.status}`)
      const { objectIDs } = (await res.json()) as MetSearchResponse
      if (!objectIDs || objectIDs.length === 0) return []
      const n = Math.min(config.maxObjects ?? q.limit ?? 12, 30)
      const objects = await Promise.all(objectIDs.slice(0, n).map(async (id) => {
        try {
          const r = await ctx.fetch(`${BASE}/objects/${id}`, { signal: ctx.signal })
          if (!r.ok) return null
          return (await r.json()) as MetObject
        } catch {
          return null // one bad object fetch must not drop the whole batch
        }
      }))
      return objects
        .map((o) => (o ? toReference(o) : null))
        .filter((r): r is Reference => r !== null)
    },
  })
}
