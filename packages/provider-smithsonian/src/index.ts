import {
  defineProvider, referenceId,
  setIfString, setIfNonNegativeInt,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
  offsetForPage,
} from '@refkit/core'

export interface SmithsonianConfig {
  /** api.data.gov API key (BYOK). */
  apiKey: string
}

export interface SmithsonianSearchOptions {
  start?: number
  rows?: number
  sort?: 'id' | 'newest' | 'updated' | 'random'
  type?: 'edanmdm' | 'ead_collection' | 'ead_component' | 'all'
  rowGroup?: 'objects' | 'archives'
  filterQuery?: string
}

interface SiMedia { type?: string; content?: string; thumbnail?: string; usage?: { access?: string } }
interface SiRow {
  id: string
  title?: string
  content?: {
    descriptiveNonRepeating?: {
      title?: { content?: string }
      record_link?: string
      guid?: string
      online_media?: { media?: SiMedia[] }
    }
  }
}
interface SiResponse { response?: { rows?: SiRow[] } }

function toReference(row: SiRow): Reference | null {
  const dnr = row.content?.descriptiveNonRepeating
  const media = dnr?.online_media?.media ?? []
  // Per-media CC0 is the authoritative image-rights flag (distinct from the
  // record-level metadata_usage, which is CC0 even on rights-restricted objects).
  const cc0 = media.find((m) => m.usage?.access === 'CC0' && (m.content || m.thumbnail))
  if (!cc0) return null
  const canonicalUrl = dnr?.record_link ?? dnr?.guid
  if (!canonicalUrl) return null
  const image = cc0.content ?? cc0.thumbnail!
  const rights: RightsRecord = {
    license: 'CC0-1.0',
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://www.si.edu/openaccess', sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('smithsonian', canonicalUrl),
    modality: 'image',
    title: dnr?.title?.content || row.title || undefined,
    source: { providerId: 'smithsonian', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(cc0.thumbnail ? { thumbnail: { url: cc0.thumbnail } } : {}),
    preview: { url: image, mediaType: 'image/jpeg' },
    relevance: 0,
    raw: row,
  }
}

export function smithsonian(config: SmithsonianConfig) {
  return defineProvider({
    id: 'smithsonian',
    modalities: ['image'],
    capabilities: { controls: ['page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.si.edu/openaccess/api/v1.0/search')
      url.searchParams.set('api_key', config.apiKey)
      url.searchParams.set('q', q.text)
      url.searchParams.set('rows', String(q.limit ?? 20))
      // offset-based API: translate the 1-based page control (providerOptions.start overrides below)
      setIfNonNegativeInt(url, 'start', offsetForPage(q.controls?.page, q.limit ?? 20))
      // bias toward CC0 image records; toReference stays authoritative per media
      url.searchParams.set('fq', 'online_media_type:"Images" AND media_usage:"CC0"')
      const opts = q.providerOptions as SmithsonianSearchOptions | undefined
      setIfNonNegativeInt(url, 'start', opts?.start)
      setIfNonNegativeInt(url, 'rows', opts?.rows, { max: 1000, clamp: true })
      setIfString(url, 'sort', opts?.sort, ['id', 'newest', 'updated', 'random'])
      setIfString(url, 'type', opts?.type, ['edanmdm', 'ead_collection', 'ead_component', 'all'])
      setIfString(url, 'row_group', opts?.rowGroup, ['objects', 'archives'])
      if (opts?.filterQuery) {
        url.searchParams.set('fq', `${url.searchParams.get('fq')} AND ${opts.filterQuery}`)
      }
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`smithsonian search failed: ${res.status}`)
      const json = (await res.json()) as SiResponse
      return (json.response?.rows ?? [])
        .map(toReference)
        .filter((r): r is Reference => r !== null)
    },
  })
}
