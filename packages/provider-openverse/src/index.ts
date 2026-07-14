import {
  defineProvider, referenceId, ccVersionFor,
  setIfString, setIfStringList, setIfBoolean, setIfPositiveInt, setIfNumber,
  CC_FAMILY_BY_TOKEN,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface OpenverseConfig {
  /** Optional OAuth2 bearer token; anonymous works (lower rate limits). */
  token?: string
}

export interface OpenverseSearchOptions {
  page?: number
  pageSize?: number
  source?: string | readonly string[]
  excludedSource?: string | readonly string[]
  tags?: string | readonly string[]
  title?: string | readonly string[]
  creator?: string | readonly string[]
  collection?: 'tag' | 'source' | 'creator'
  collectionTag?: string
  license?: string | readonly string[]
  licenseType?: 'all' | 'all-cc' | 'commercial' | 'modification'
  filterDead?: boolean
  extension?: string | readonly string[]
  mature?: boolean
  sortBy?: 'relevance' | 'indexed_on'
  sortDir?: 'desc' | 'asc'
  authority?: boolean
  authorityBoost?: number
  includeSensitiveResults?: boolean
  category?: string | readonly string[]
}

export interface OpenverseImageSearchOptions extends OpenverseSearchOptions {
  aspectRatio?: string | readonly string[]
  size?: string | readonly string[]
}

export interface OpenverseAudioSearchOptions extends OpenverseSearchOptions {
  length?: string | readonly string[]
}

interface OpenverseResult {
  id: string
  title: string | null
  creator: string | null
  foreign_landing_url: string
  url: string
  thumbnail: string
  width: number
  height: number
  license: string
  license_version: string
  license_url: string
  creator_url?: string | null
  attribution?: string | null
}
interface OpenverseResponse { results: OpenverseResult[] }

// Map Openverse's per-item `license` code to our LicenseId. The CC version is
// captured separately (rights.licenseVersion) and doesn't change the permission
// family, so all six CC families (BY/BY-SA/BY-NC/BY-NC-SA/BY-NC-ND/BY-ND) map
// regardless of version; commercial/modification permissions still gate through
// core's LICENSE_FACTS (NC stays denied for commercial, ND for modification).
// The six CC-family codes are identical to core's CC_FAMILY_BY_TOKEN keys, so
// they're delegated there instead of duplicated. Bespoke sampling deeds aren't
// clean family grants, so they stay 'proprietary'.
export function mapOpenverseLicense(code: string): LicenseId {
  switch (code) {
    case 'cc0': return 'CC0-1.0'
    case 'pdm': return 'PD'
    case 'sampling':
    case 'sampling+':
    case 'nc-sampling+':
      return 'proprietary' // bespoke sampling licences — not clean family grants
    default: return CC_FAMILY_BY_TOKEN[code] ?? 'unknown'
  }
}

function openverseLicenseType(license: import('@refkit/core').SearchLicenseControls | undefined): string {
  if (license?.allowUnknown) return 'all'
  const types: string[] = []
  if (license?.commercial) types.push('commercial')
  if (license?.modification) types.push('modification')
  return types.length > 0 ? types.join(',') : 'commercial,modification'
}

function hasStringList(value: unknown): boolean {
  return (typeof value === 'string' && value.length > 0)
    || (Array.isArray(value) && value.some(v => typeof v === 'string' && v.length > 0))
}

function applyOpenverseSearchOptions(url: URL, opts: OpenverseSearchOptions | undefined) {
  if (!opts) return
  setIfPositiveInt(url, 'page', opts.page)
  setIfPositiveInt(url, 'page_size', opts.pageSize)
  setIfStringList(url, 'source', opts.source)
  setIfStringList(url, 'excluded_source', opts.excludedSource)
  const fieldSearch = hasStringList(opts.tags) || hasStringList(opts.title) || hasStringList(opts.creator)
  if (fieldSearch) url.searchParams.delete('q')
  setIfStringList(url, 'tags', opts.tags)
  setIfStringList(url, 'title', opts.title)
  setIfStringList(url, 'creator', opts.creator)
  if (opts.collection === 'tag' || opts.collection === 'source' || opts.collection === 'creator') {
    url.searchParams.delete('q')
    setIfString(url, 'unstable__collection', opts.collection, ['tag', 'source', 'creator'])
  }
  setIfString(url, 'unstable__tag', opts.collectionTag)
  setIfStringList(url, 'license', opts.license)
  setIfString(url, 'license_type', opts.licenseType, ['all', 'all-cc', 'commercial', 'modification'])
  setIfBoolean(url, 'filter_dead', opts.filterDead)
  setIfStringList(url, 'extension', opts.extension)
  setIfBoolean(url, 'mature', opts.mature)
  setIfString(url, 'unstable__sort_by', opts.sortBy, ['relevance', 'indexed_on'])
  setIfString(url, 'unstable__sort_dir', opts.sortDir, ['desc', 'asc'])
  setIfBoolean(url, 'unstable__authority', opts.authority)
  setIfNumber(url, 'unstable__authority_boost', opts.authorityBoost, { min: 0, max: 10 })
  setIfBoolean(url, 'unstable__include_sensitive_results', opts.includeSensitiveResults)
  setIfStringList(url, 'category', opts.category)
}

function toReference(r: OpenverseResult): Reference {
  const license = mapOpenverseLicense(r.license)
  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), captured for all CC families.
    licenseVersion: ccVersionFor(license, r.license_version),
    author: r.creator ?? undefined,
    // governed by the per-item CC/PD license (Openverse imposes no hotlink/download-trigger requirement)
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: r.license_url, sourceUrl: r.foreign_landing_url },
  }
  return {
    id: referenceId('openverse', r.foreign_landing_url),
    modality: 'image',
    title: r.title ?? undefined,
    source: { providerId: 'openverse', sourceUrl: r.foreign_landing_url },
    canonicalUrl: r.foreign_landing_url,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: r.thumbnail },
    visual: { width: r.width, height: r.height },
    relevance: 0, // per-source order; mergeReferences assigns the final RRF relevance
    raw: r,
  }
}

export function openverse(config: OpenverseConfig = {}) {
  return defineProvider({
    id: 'openverse',
    modalities: ['image'],
    capabilities: { controls: ['license.commercial', 'license.modification', 'license.allowUnknown', 'page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.openverse.org/v1/images/')
      url.searchParams.set('q', q.text)
      url.searchParams.set('license_type', openverseLicenseType(q.controls?.license)) // performance/relevance hint only — the AUTHORITATIVE rights gate is mapOpenverseLicense below, not this filter
      url.searchParams.set('page_size', String(q.limit ?? 20))
      if (q.controls?.page) url.searchParams.set('page', String(q.controls.page))
      const opts = q.providerOptions as OpenverseImageSearchOptions | undefined
      applyOpenverseSearchOptions(url, opts)
      setIfStringList(url, 'aspect_ratio', opts?.aspectRatio)
      setIfStringList(url, 'size', opts?.size)
      const headers: Record<string, string> = {}
      if (config.token) headers.Authorization = `Bearer ${config.token}`
      const res = await ctx.fetch(url.toString(), { headers, signal: ctx.signal })
      if (!res.ok) throw new Error(`openverse search failed: ${res.status}`)
      const json = (await res.json()) as OpenverseResponse
      return json.results.map(toReference)
    },
  })
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus',
}

interface OpenverseAudioResult {
  id: string
  title: string | null
  creator: string | null
  foreign_landing_url: string
  url: string
  thumbnail: string | null
  license: string
  license_version: string
  license_url: string
  filetype?: string | null
  waveform?: string | null
}
interface OpenverseAudioResponse { results: OpenverseAudioResult[] }

function toAudioReference(r: OpenverseAudioResult): Reference {
  const license = mapOpenverseLicense(r.license)
  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), captured for all CC families.
    licenseVersion: ccVersionFor(license, r.license_version),
    author: r.creator ?? undefined,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: r.license_url, sourceUrl: r.foreign_landing_url },
  }
  return {
    id: referenceId('openverse-audio', r.foreign_landing_url),
    modality: 'audio',
    title: r.title ?? undefined,
    source: { providerId: 'openverse-audio', sourceUrl: r.foreign_landing_url },
    canonicalUrl: r.foreign_landing_url,
    rights,
    verifiedAt: new Date().toISOString(),
    // audio has no image; the waveform render is the closest visual handle
    ...(r.waveform ? { thumbnail: { url: r.waveform } } : {}),
    preview: { url: r.url, mediaType: AUDIO_MIME[r.filetype ?? ''] ?? 'audio/mpeg' },
    relevance: 0,
    raw: r,
  }
}

// Openverse also serves CC/PD audio under the same key/shape — a near-free audio leg.
export function openverseAudio(config: OpenverseConfig = {}) {
  return defineProvider({
    id: 'openverse-audio',
    modalities: ['audio'],
    capabilities: { controls: ['license.commercial', 'license.modification', 'license.allowUnknown', 'page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.openverse.org/v1/audio/')
      url.searchParams.set('q', q.text)
      url.searchParams.set('license_type', openverseLicenseType(q.controls?.license)) // relevance hint; mapOpenverseLicense authoritative
      url.searchParams.set('page_size', String(q.limit ?? 20))
      if (q.controls?.page) url.searchParams.set('page', String(q.controls.page))
      const opts = q.providerOptions as OpenverseAudioSearchOptions | undefined
      applyOpenverseSearchOptions(url, opts)
      setIfStringList(url, 'length', opts?.length)
      const headers: Record<string, string> = {}
      if (config.token) headers.Authorization = `Bearer ${config.token}`
      const res = await ctx.fetch(url.toString(), { headers, signal: ctx.signal })
      if (!res.ok) throw new Error(`openverse audio search failed: ${res.status}`)
      const json = (await res.json()) as OpenverseAudioResponse
      return json.results.map(toAudioReference)
    },
  })
}
