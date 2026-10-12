import {
  defineProvider, okJson, ccVersionFor,
  setIfString, setIfStringList, setIfBoolean, setIfPositiveInt, setIfNumber,
  CC_FAMILY_BY_TOKEN,
  type EmittedReference, type RightsRecord, type LicenseId, type AudioMeta,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface OpenverseConfig {
  /** Optional OAuth2 bearer token; anonymous works, but is limited to 20 results per request. */
  token?: string
}

// api.openverse.org rejects anonymous requests above this with 401:
// {"detail":"page_size may not exceed 20 for anonymous requests"}
const ANONYMOUS_MAX_PAGE_SIZE = 20

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

// Applied last, after provider options are set, so `providerOptions.pageSize` can't
// re-exceed the anonymous ceiling. No-op when a token is configured.
function capAnonymousPageSize(url: URL, config: OpenverseConfig): void {
  if (config.token) return
  const requested = Number(url.searchParams.get('page_size'))
  url.searchParams.set('page_size', String(Math.min(requested, ANONYMOUS_MAX_PAGE_SIZE)))
}

function toReference(r: OpenverseResult): EmittedReference {
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
    modality: 'image',
    title: r.title ?? undefined,
    sourceUrl: r.foreign_landing_url,
    rights,
    thumbnail: { url: r.thumbnail },
    visual: { width: r.width, height: r.height },
    raw: r,
  }
}

export function openverse(config: OpenverseConfig = {}) {
  return defineProvider({
    id: 'openverse',
    modalities: ['image'],
    description: 'Aggregated openly licensed images from many sources (Openverse)',
    capabilities: { controls: ['license.commercial', 'license.modification', 'license.allowUnknown', 'page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
      const url = new URL('https://api.openverse.org/v1/images/')
      url.searchParams.set('q', q.text)
      url.searchParams.set('license_type', openverseLicenseType(q.controls?.license)) // performance/relevance hint only — the AUTHORITATIVE rights gate is mapOpenverseLicense below, not this filter
      url.searchParams.set('page_size', String(q.limit ?? 20))
      setIfPositiveInt(url, 'page', q.controls?.page)
      const opts = q.providerOptions as OpenverseImageSearchOptions | undefined
      applyOpenverseSearchOptions(url, opts)
      setIfStringList(url, 'aspect_ratio', opts?.aspectRatio)
      setIfStringList(url, 'size', opts?.size)
      capAnonymousPageSize(url, config)
      const headers: Record<string, string> = {}
      if (config.token) headers.Authorization = `Bearer ${config.token}`
      const res = await ctx.fetch(url.toString(), { headers, signal: ctx.signal })
      const json = await okJson<OpenverseResponse>(res, 'openverse search')
      return json.results.map(toReference)
    },
  })
}

// The one table that decides both `audio.format` and `preview.mediaType`, so the
// two never disagree. Every type has the `audio/` prefix the audio variant's schema
// requires (an audio-only WebM is `audio/webm`, not `video/webm`).
const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus',
  mid: 'audio/midi', midi: 'audio/midi', webm: 'audio/webm',
}

// Source-specific `filetype` codes that name a format in AUDIO_MIME: Jamendo's
// mp31 (96 kbps mp3) and mp32 (VBR mp3), and Wikimedia's ogx (an Ogg Vorbis
// stream, served as application/ogg from a .ogg/.oga/.opus URL).
const FILETYPE_ALIASES: Record<string, string> = { mp31: 'mp3', mp32: 'mp3', ogx: 'ogg' }

interface OpenverseAudioResult {
  id: string
  title: string | null
  creator: string | null
  foreign_landing_url: string
  url: string
  /** Album art (`/v1/audio/<id>/thumb/`, image/jpeg); null when the item has none. */
  thumbnail: string | null
  license: string
  license_version: string
  license_url: string
  filetype?: string | null
  /** Milliseconds. */
  duration?: number | null
  /** Bits per second; null for Jamendo-sourced items. */
  bit_rate?: number | null
  /** Hertz; often null. */
  sample_rate?: number | null
  /** Top-level classification: audiobook, music, news, podcast, pronunciation,
   *  sound_effect; null for Freesound-sourced items. */
  category?: string | null
}
interface OpenverseAudioResponse { results: OpenverseAudioResult[] }

const positive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

/** `filetype` as a file format, case-insensitive, with the aliases above
 *  resolved; a value that is not a key of AUDIO_MIME yields undefined. */
function audioFormat(filetype: string | null | undefined): string | undefined {
  const t = (filetype ?? '').toLowerCase()
  const format = Object.hasOwn(FILETYPE_ALIASES, t) ? FILETYPE_ALIASES[t] : t
  return Object.hasOwn(AUDIO_MIME, format) ? format : undefined
}

function audioMeta(r: OpenverseAudioResult, format: string | undefined): AudioMeta | undefined {
  const meta: AudioMeta = {}
  if (positive(r.duration)) meta.durationSec = r.duration / 1000
  if (positive(r.bit_rate)) meta.bitrateKbps = r.bit_rate / 1000
  if (positive(r.sample_rate)) meta.sampleRateHz = r.sample_rate
  if (format) meta.format = format
  return Object.keys(meta).length > 0 ? meta : undefined
}

/** Openverse `category` → kind, only for the values that clearly mean one of the
 *  declared kinds (pronunciation, podcast, audiobook and news stay unset). */
function audioKind(category: string | null | undefined): string | undefined {
  if (category === 'music') return 'music'
  if (category === 'sound_effect') return 'sound-effect'
  return undefined
}

function toAudioReference(r: OpenverseAudioResult): EmittedReference {
  const license = mapOpenverseLicense(r.license)
  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), captured for all CC families.
    licenseVersion: ccVersionFor(license, r.license_version),
    author: r.creator ?? undefined,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: r.license_url, sourceUrl: r.foreign_landing_url },
  }
  const format = audioFormat(r.filetype)
  const kind = audioKind(r.category)
  const audio = audioMeta(r, format)
  return {
    modality: 'audio',
    ...(kind ? { kind } : {}),
    title: r.title ?? undefined,
    sourceUrl: r.foreign_landing_url,
    rights,
    // The album art. The `waveform` URL is JSON peak data, not an image, so it is
    // never a thumbnail.
    ...(r.thumbnail ? { thumbnail: { url: r.thumbnail } } : {}),
    // A filetype outside AUDIO_MIME gets no preview rather than a guessed type: a
    // host may re-serve this cache-allowed file under preview.mediaType. (Every
    // filetype seen live in 2026-10 is in the table.)
    ...(format ? { preview: { url: r.url, mediaType: AUDIO_MIME[format] } } : {}),
    ...(audio ? { audio } : {}),
    raw: r,
  }
}

// Openverse also serves CC/PD audio under the same key/shape — a near-free audio leg.
export function openverseAudio(config: OpenverseConfig = {}) {
  return defineProvider({
    id: 'openverse-audio',
    modalities: ['audio'],
    kinds: ['music', 'sound-effect'],
    description: 'Aggregated openly licensed music and sound effects (Openverse)',
    capabilities: { controls: ['license.commercial', 'license.modification', 'license.allowUnknown', 'page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
      const url = new URL('https://api.openverse.org/v1/audio/')
      url.searchParams.set('q', q.text)
      url.searchParams.set('license_type', openverseLicenseType(q.controls?.license)) // relevance hint; mapOpenverseLicense authoritative
      url.searchParams.set('page_size', String(q.limit ?? 20))
      setIfPositiveInt(url, 'page', q.controls?.page)
      const opts = q.providerOptions as OpenverseAudioSearchOptions | undefined
      applyOpenverseSearchOptions(url, opts)
      setIfStringList(url, 'length', opts?.length)
      capAnonymousPageSize(url, config)
      const headers: Record<string, string> = {}
      if (config.token) headers.Authorization = `Bearer ${config.token}`
      const res = await ctx.fetch(url.toString(), { headers, signal: ctx.signal })
      const json = await okJson<OpenverseAudioResponse>(res, 'openverse audio search')
      return json.results.map(toAudioReference)
    },
  })
}
