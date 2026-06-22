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
}
interface OpenverseResponse { results: OpenverseResult[] }

// Combine Openverse's per-item `license` code + `license_version` into our LicenseId.
// Only CC0/PD and version-4.0 BY/BY-SA are in our permissive enum; older CC versions
// → 'unknown' (strict-deny → needs-review); NC/ND variants → 'proprietary' (→ denied).
export function mapOpenverseLicense(code: string, version: string): LicenseId {
  switch (code) {
    case 'cc0': return 'CC0-1.0'
    case 'pdm': return 'PD'
    case 'by': return version === '4.0' ? 'CC-BY-4.0' : 'unknown'
    case 'by-sa': return version === '4.0' ? 'CC-BY-SA-4.0' : 'unknown'
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
  const rights: RightsRecord = {
    license: mapOpenverseLicense(r.license, r.license_version),
    author: r.creator ?? undefined,
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
      url.searchParams.set('license_type', 'commercial,modification') // bias to usable
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
