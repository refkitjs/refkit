import {
  defineProvider, referenceId,
  setIfString, setIfPositiveInt, mapCcDeedUrl, ccVersionFor,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

// Freesound's `license` is usually a CC NAME string ("Attribution", "Creative
// Commons 0") but has historically also been a CC DEED URL. Handle both.
// D4: name → family LicenseId, no version. D7: URL → family + version (ccVersionFor).
// Sampling+ licences are bespoke (not a clean CC free grant) → stay proprietary.
const FREESOUND_NAME_LICENSE: Record<string, { license: LicenseId }> = {
  'attribution': { license: 'CC-BY' },
  'attribution noncommercial': { license: 'CC-BY-NC' },          // NC family — commercial/AI use still gates to denied
  'creative commons 0': { license: 'CC0-1.0' },
  'sampling+': { license: 'proprietary' },                       // bespoke CC sampling licence, not a clean free grant
  'attribution sampling+': { license: 'proprietary' },
}

/** Map a Freesound `license` value (CC name string OR CC deed URL) to our
 *  license + optional CC version. Unrecognized → `unknown` (strict-deny). */
export function mapFreesoundLicense(value: string): { license: LicenseId; version?: string } {
  const v = (value ?? '').trim()
  if (!v) return { license: 'unknown' }

  // D7 — deed URL form: delegate to the core CC-deed mapper (identical CC handling).
  if (/^https?:\/\//i.test(v)) return mapCcDeedUrl(v)

  // D4 — name string form (case-insensitive)
  return FREESOUND_NAME_LICENSE[v.toLowerCase()] ?? { license: 'unknown' }
}

export interface FreesoundConfig {
  /** Freesound APIv2 token (https://freesound.org/apiv2/apply). Passed as the
   *  `token` query param. The `Authorization: Token <key>` header is the documented
   *  equivalent if a future need arises. */
  apiKey: string
}

export interface FreesoundSearchOptions {
  /** Freesound `sort` (e.g. 'score', 'rating_desc', 'downloads_desc', 'created_desc'). */
  sort?: string
  /** Freesound `filter` query (field-scoped Solr-style filter, e.g. 'duration:[1 TO 10]'). */
  filter?: string
  page?: number
  pageSize?: number
}

const BASE = 'https://freesound.org/apiv2/search/text/'
// Fields must be requested explicitly — default search responses omit previews/license.
const FIELDS = 'id,name,license,username,previews,url,duration,filesize,tags'

interface FreesoundResult {
  id: number
  name: string
  license: string
  username?: string
  url: string
  previews?: Record<string, string>
  duration?: number
  filesize?: number
  tags?: string[]
}
interface FreesoundResponse { count: number; results: FreesoundResult[] }

function toAudioReference(r: FreesoundResult): Reference | null {
  if (!r.url) return null // no canonical URL → unusable; drop rather than crash the batch
  const { license, version } = mapFreesoundLicense(r.license)
  const canonicalUrl = r.url
  const rights: RightsRecord = {
    license,
    // version is only ever populated by mapFreesoundLicense for the deed-URL form (D7);
    // the name-string form (D4) never sets `version`, so this is undefined either way.
    licenseVersion: ccVersionFor(license, version),
    author: r.username || undefined,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://freesound.org/help/tos_api/', sourceUrl: canonicalUrl },
  }
  const previewUrl = r.previews?.['preview-hq-mp3'] ?? r.previews?.['preview-lq-mp3']
  return {
    id: referenceId('freesound', canonicalUrl),
    modality: 'audio',
    title: r.name || undefined,
    source: { providerId: 'freesound', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(previewUrl ? { preview: { url: previewUrl, mediaType: 'audio/mpeg' } } : {}),
    relevance: 0, // mergeReferences assigns the final RRF relevance
    raw: r,
  }
}

export function freesound(config: FreesoundConfig) {
  return defineProvider({
    id: 'freesound',
    modalities: ['audio'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const opts = q.providerOptions as FreesoundSearchOptions | undefined
      const url = new URL(BASE)
      url.searchParams.set('query', q.text)
      url.searchParams.set('token', config.apiKey)
      url.searchParams.set('fields', FIELDS)
      url.searchParams.set('page_size', String(opts?.pageSize ?? q.limit ?? 20))
      setIfString(url, 'sort', opts?.sort)
      setIfString(url, 'filter', opts?.filter)
      setIfPositiveInt(url, 'page', opts?.page)
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`freesound search failed: ${res.status}`)
      const json = (await res.json()) as FreesoundResponse
      if (!json.results) return []
      return json.results.map(toAudioReference).filter((x): x is Reference => x !== null)
    },
  })
}
