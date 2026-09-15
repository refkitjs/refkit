import {
  defineProvider, okJson, setIfString, setIfNonNegativeInt, setIfStringList,
  type EmittedReference, type RightsRecord, type NormalizedQuery, type ProviderContext,
  setIfPositiveInt,
} from '@refkit/core'

interface ArticArtwork {
  id: number
  title: string
  image_id: string | null
  is_public_domain: boolean
  artist_display: string | null
}
interface ArticResponse {
  data: ArticArtwork[]
  config?: { iiif_url?: string }
}

export interface ArticSearchOptions {
  sort?: string
  from?: number
  size?: number
  facets?: string | readonly string[]
  fields?: string | readonly string[]
}

// AIC's artist_display packs name + nationality + dates across lines; keep the first line.
function artistName(display: string | null): string | undefined {
  if (!display) return undefined
  return display.split('\n')[0].trim() || undefined
}

function toReference(a: ArticArtwork, iiifUrl: string): EmittedReference | null {
  // Open-access (public-domain) works are CC0; everything else has no usable image.
  if (!a.is_public_domain || !a.image_id) return null
  const sourceUrl = `https://www.artic.edu/artworks/${a.id}`
  const rights: RightsRecord = {
    license: 'CC0-1.0',
    author: artistName(a.artist_display),
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://www.artic.edu/terms', sourceUrl },
  }
  return {
    modality: 'image',
    kind: 'artwork',
    title: a.title || undefined,
    sourceUrl,
    rights,
    thumbnail: { url: `${iiifUrl}/${a.image_id}/full/200,/0/default.jpg` },
    preview: { url: `${iiifUrl}/${a.image_id}/full/843,/0/default.jpg`, mediaType: 'image/jpeg' },
    raw: a,
  }
}

function articFields(value: unknown): string {
  const fields = new Set(['id', 'title', 'image_id', 'is_public_domain', 'artist_display'])
  if (typeof value === 'string') {
    for (const item of value.split(',')) if (item.trim()) fields.add(item.trim())
  }
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
    for (const item of value) if (item) fields.add(item)
  }
  return Array.from(fields).join(',')
}

export function artic() {
  return defineProvider({
    id: 'artic',
    modalities: ['image'],
    kinds: ['artwork'],
    description: 'CC0 artworks from the Art Institute of Chicago',
    capabilities: { controls: ['page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
      const url = new URL('https://api.artic.edu/api/v1/artworks/search')
      url.searchParams.set('q', q.text)
      const opts = q.providerOptions as ArticSearchOptions | undefined
      // relevance hint — toReference is authoritative on is_public_domain
      url.searchParams.set('query[term][is_public_domain]', 'true')
      url.searchParams.set('fields', articFields(opts?.fields))
      url.searchParams.set('limit', String(q.limit ?? 20))
      setIfPositiveInt(url, 'page', q.controls?.page)
      setIfString(url, 'sort', opts?.sort)
      setIfNonNegativeInt(url, 'from', opts?.from)
      setIfNonNegativeInt(url, 'size', opts?.size)
      setIfStringList(url, 'facets', opts?.facets)
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      const json = await okJson<ArticResponse>(res, 'artic search')
      const iiif = json.config?.iiif_url ?? 'https://www.artic.edu/iiif/2'
      return json.data
        .map((a) => toReference(a, iiif))
        .filter((r): r is EmittedReference => r !== null)
    },
  })
}
