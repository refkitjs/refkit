import {
  defineProvider, okJson, plainText, setIfString, setIfNonNegativeInt, setIfStringList,
  type EmittedReference, type RightsRecord, type NormalizedQuery, type ProviderContext,
  setIfPositiveInt,
} from '@refkit/core'

interface ArticArtwork {
  id: number
  title: string
  image_id: string | null
  is_public_domain: boolean
  artist_display: string | null
  /** Elasticsearch relevance from the /search endpoint — AIC's own scale. */
  _score?: number
  short_description?: string | null
  medium_display?: string | null
  classification_titles?: string[]
  subject_titles?: string[]
  term_titles?: string[]
}
interface ArticResponse {
  data: ArticArtwork[]
  config?: { iiif_url?: string }
}

// api.artic.edu returns 403 {"error":"Invalid limit"} when `limit` exceeds this.
const MAX_LIMIT = 100

export interface ArticSearchOptions {
  sort?: string
  from?: number
  size?: number
  facets?: string | readonly string[]
  /** Caller-requested fields are ADDED to the provider's own defaults (id, title,
   *  image_id, …), never replacing them. */
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
  // short_description is editorial HTML; medium_display ("Bronze") is the fallback caption.
  const description = plainText(a.short_description) ?? plainText(a.medium_display)
  // three parallel controlled vocabularies that overlap (a bronze sculpture of animals
  // appears in term_titles and subject_titles) — union, first occurrence wins.
  const tags = [...new Set([
    ...(a.classification_titles ?? []),
    ...(a.subject_titles ?? []),
    ...(a.term_titles ?? []),
  ])]
  return {
    modality: 'image',
    kind: 'artwork',
    title: a.title || undefined,
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(typeof a._score === 'number' && Number.isFinite(a._score) ? { sourceScore: a._score } : {}),
    sourceUrl,
    rights,
    thumbnail: { url: `${iiifUrl}/${a.image_id}/full/200,/0/default.jpg` },
    preview: { url: `${iiifUrl}/${a.image_id}/full/843,/0/default.jpg`, mediaType: 'image/jpeg' },
    raw: a,
  }
}

function articFields(value: unknown): string {
  const fields = new Set([
    'id', 'title', 'image_id', 'is_public_domain', 'artist_display',
    // descriptive + score fields: EmittedReference.description / .tags / .sourceScore
    'short_description', 'medium_display', 'classification_titles', 'subject_titles', 'term_titles',
  ])
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
      url.searchParams.set('limit', String(Math.min(q.limit ?? 20, MAX_LIMIT)))
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
