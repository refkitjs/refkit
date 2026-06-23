import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface OpenverseConfig {
  /** Optional OAuth2 bearer token; anonymous works (lower rate limits). */
  token?: string
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
// family, so BY/BY-SA map regardless of version; NC/ND variants → 'proprietary'.
export function mapOpenverseLicense(code: string): LicenseId {
  switch (code) {
    case 'cc0': return 'CC0-1.0'
    case 'pdm': return 'PD'
    case 'by': return 'CC-BY'
    case 'by-sa': return 'CC-BY-SA'
    case 'by-nc':
    case 'by-nc-sa':
    case 'by-nc-nd':
    case 'by-nd':
    case 'sampling':
    case 'sampling+':
    case 'nc-sampling+':
      return 'proprietary'
    default: return 'unknown'
  }
}

function toReference(r: OpenverseResult): Reference {
  const license = mapOpenverseLicense(r.license)
  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), captured for the BY/BY-SA family.
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? r.license_version : undefined,
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
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.openverse.org/v1/images/')
      url.searchParams.set('q', q.text)
      url.searchParams.set('license_type', 'commercial,modification') // performance/relevance hint only — the AUTHORITATIVE rights gate is mapOpenverseLicense below, not this filter
      url.searchParams.set('page_size', String(q.limit ?? 20))
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
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? r.license_version : undefined,
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
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.openverse.org/v1/audio/')
      url.searchParams.set('q', q.text)
      url.searchParams.set('license_type', 'commercial,modification') // relevance hint; mapOpenverseLicense authoritative
      url.searchParams.set('page_size', String(q.limit ?? 20))
      const headers: Record<string, string> = {}
      if (config.token) headers.Authorization = `Bearer ${config.token}`
      const res = await ctx.fetch(url.toString(), { headers, signal: ctx.signal })
      if (!res.ok) throw new Error(`openverse audio search failed: ${res.status}`)
      const json = (await res.json()) as OpenverseAudioResponse
      return json.results.map(toAudioReference)
    },
  })
}
