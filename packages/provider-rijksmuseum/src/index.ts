import {
  defineProvider, referenceId,
  setIfString, setIfBoolean, mapRightsUrl, ccVersionFor,
  type Reference, type RightsRecord,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface RijksmuseumConfig {
  /** Max records fetched per search. Search returns only IDs, so each result
   *  costs one extra EDM fetch, bounding the N+1 fan-out. Default 12. */
  maxObjects?: number
}

export interface RijksmuseumSearchOptions {
  /** Object type, e.g. 'painting'. */
  type?: string
  /** Material, e.g. 'canvas'. */
  material?: string
  /** Technique, e.g. 'oil paint'. */
  technique?: string
  /** Maker/artist (maps to creator). */
  creator?: string
  /** Free-text description match. */
  description?: string
  /** Restrict to objects with an image. */
  imageAvailable?: boolean
}

const SEARCH = 'https://data.rijksmuseum.nl/search/collection'
const RIJKS_TERMS = 'https://www.rijksmuseum.nl/en/data/policy'
const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel'

interface EdmLink {
  id?: string
}

interface EdmCreatorLabel {
  '@language'?: string
  '@value'?: string
}

interface EdmCreator {
  [SKOS_PREF_LABEL]?: EdmCreatorLabel[]
}

interface EdmAggregatedCho {
  id?: string
  title?: Record<string, unknown>
  creator?: EdmCreator[]
}

interface EdmRecord {
  edmRights?: string
  isShownAt?: EdmLink
  isShownBy?: EdmLink
  object?: EdmLink
  aggregatedCHO?: EdmAggregatedCho
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === 'string' && item.length > 0)
}

function firstLocalized(value: unknown, preferredLanguages: string[]): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return firstString(value)
  const localized = value as Record<string, unknown>
  for (const language of preferredLanguages) {
    const text = firstString(localized[language])
    if (text) return text
  }
  for (const candidate of Object.values(localized)) {
    const text = firstString(candidate)
    if (text) return text
  }
  return undefined
}

function firstCreatorLabel(
  creators: EdmCreator[] | undefined,
  preferredLanguages: string[],
): string | undefined {
  const labels = (creators ?? []).flatMap(creator => creator[SKOS_PREF_LABEL] ?? [])
  for (const language of preferredLanguages) {
    for (const label of labels) {
      if (label['@language'] !== language) continue
      const text = firstString(label['@value'])
      if (text) return text
    }
  }
  for (const label of labels) {
    const text = firstString(label['@value'])
    if (text) return text
  }
  return undefined
}

function toReference(rec: EdmRecord): Reference | null {
  const canonicalUrl = rec.aggregatedCHO?.id
  const imageUrl = rec.isShownBy?.id ?? rec.object?.id
  if (typeof canonicalUrl !== 'string' || !canonicalUrl) return null
  if (typeof imageUrl !== 'string' || !imageUrl) return null

  const shownAt = rec.isShownAt?.id
  const sourceUrl = typeof shownAt === 'string' && shownAt ? shownAt : canonicalUrl
  const rightsUrl = typeof rec.edmRights === 'string' ? rec.edmRights : undefined
  const { license, version, jurisdiction } = mapRightsUrl(rightsUrl)
  const rights: RightsRecord = {
    license,
    licenseVersion: ccVersionFor(license, version),
    ...(jurisdiction ? { jurisdiction } : {}),
    author: firstCreatorLabel(rec.aggregatedCHO?.creator, ['en', 'nl']),
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: RIJKS_TERMS, sourceUrl },
  }

  return {
    id: referenceId('rijksmuseum', canonicalUrl),
    modality: 'image',
    title: firstLocalized(rec.aggregatedCHO?.title, ['en', 'nl']),
    source: { providerId: 'rijksmuseum', sourceUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: imageUrl },
    preview: { url: imageUrl, mediaType: 'image/jpeg' },
    relevance: 0,
    raw: rec,
  }
}

interface SearchPage {
  orderedItems?: Array<{ id?: string }>
}

export function rijksmuseum(config: RijksmuseumConfig = {}) {
  return defineProvider({
    id: 'rijksmuseum',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const opts = q.providerOptions as RijksmuseumSearchOptions | undefined
      const n = Math.min(config.maxObjects ?? q.limit ?? 12, 30)
      const searchUrl = new URL(SEARCH)
      // The API has no global free-text parameter; title is its partial keyword match.
      if (q.text) searchUrl.searchParams.set('title', q.text)
      setIfString(searchUrl, 'type', opts?.type)
      setIfString(searchUrl, 'material', opts?.material)
      setIfString(searchUrl, 'technique', opts?.technique)
      setIfString(searchUrl, 'creator', opts?.creator)
      setIfString(searchUrl, 'description', opts?.description)
      setIfBoolean(searchUrl, 'imageAvailable', opts?.imageAvailable)

      const res = await ctx.fetch(searchUrl.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error('rijksmuseum search failed: ' + res.status)
      const page = (await res.json()) as SearchPage
      const ids = (page.orderedItems ?? [])
        .map(item => item.id)
        .filter((url): url is string => typeof url === 'string')
        .slice(0, n)
      if (ids.length === 0) return []

      const records = await Promise.all(ids.map(async (idUrl): Promise<Reference | null> => {
        try {
          const separator = idUrl.includes('?') ? '&' : '?'
          const recordUrl = idUrl + separator + '_profile=edm-framed'
          const response = await ctx.fetch(recordUrl, { signal: ctx.signal })
          if (!response.ok) return null
          const record = (await response.json()) as EdmRecord
          return toReference(record)
        } catch {
          return null
        }
      }))

      return records.filter((record): record is Reference => record !== null)
    },
  })
}
