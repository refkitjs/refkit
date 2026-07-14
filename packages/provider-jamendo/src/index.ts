import {
  defineProvider, referenceId,
  setIfString, setIfStringList, setIfBoolean, setIfNonNegativeInt, mapCcDeedUrl, ccVersionFor,
  type Reference, type RightsRecord,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface JamendoConfig {
  /** Jamendo API client_id (BYOK). Register at https://devportal.jamendo.com/. */
  clientId: string
}

export interface JamendoSearchOptions {
  /** mp3 stream quality. Default 'mp31' (96 kbps). */
  audioformat?: 'mp31' | 'mp32' | 'ogg' | 'flac'
  order?: 'relevance' | 'popularity_total' | 'popularity_month' | 'popularity_week' | 'releasedate_asc' | 'releasedate_desc' | 'buzzrate'
  /** Restrict to tracks whose license permits a given use, server-side. Relevance
   *  hint only — mapJamendoLicense below is the authoritative rights gate. */
  ccsa?: boolean
  ccnd?: boolean
  ccnc?: boolean
  tags?: string | readonly string[]
  artist_name?: string
  offset?: number
}

const BASE = 'https://api.jamendo.com/v3.0/tracks/'

// The `audioformat` request param decides what `t.audio` streams; reflect it in mediaType
// rather than hardcoding audio/mpeg (which would mislabel ogg/flac requests).
const JAMENDO_AUDIO_MIME: Record<string, string> = {
  mp31: 'audio/mpeg', mp32: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac',
}

interface JamendoTrack {
  id: string
  name: string
  artist_name: string
  audio: string
  audiodownload?: string
  image: string
  shareurl: string
  shorturl?: string
  license_ccurl: string
}
interface JamendoResponse {
  headers: { status: string; code: number; error_message?: string; results_count: number }
  results: JamendoTrack[]
}

// Jamendo deed URLs look like http(s)://creativecommons.org/licenses/<variant>/<v>/.
// All six CC families map faithfully with version captured (D7), including nc/nd
// variants (their own CC-BY-NC*/CC-BY-ND families — gating gets stricter, not
// 'proprietary'). Missing/unrecognized → 'unknown'.
// This is exactly the core CC-deed mapper, re-exported under the jamendo-specific name
// the provider's tests import.
export const mapJamendoLicense = mapCcDeedUrl

function toAudioReference(t: JamendoTrack, mediaType: string): Reference | null {
  if (!t.shareurl) return null // no canonical URL → unusable; drop rather than crash the batch
  const { license, version } = mapJamendoLicense(t.license_ccurl)
  const canonicalUrl = t.shareurl
  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), kept for every versioned CC family —
    // NC stays denied for commercial/AI use; ND allows verbatim commercial reuse
    // (allowed-with-attribution) but stays denied for AI/derivative use.
    licenseVersion: ccVersionFor(license, version),
    author: t.artist_name || undefined,
    // governed by the per-item CC license; the mp3 stream is served directly by Jamendo
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: t.license_ccurl, sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('jamendo', canonicalUrl),
    modality: 'audio',
    title: t.name || undefined,
    source: { providerId: 'jamendo', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    // audio has no native thumbnail; the album art is the closest visual handle
    ...(t.image ? { thumbnail: { url: t.image } } : {}),
    preview: { url: t.audio, mediaType },
    relevance: 0, // per-source order; mergeReferences assigns the final RRF relevance
    raw: t,
  }
}

export function jamendo(config: JamendoConfig) {
  return defineProvider({
    id: 'jamendo',
    modalities: ['audio'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL(BASE)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('format', 'json')
      url.searchParams.set('search', q.text)
      url.searchParams.set('limit', String(Math.min(q.limit ?? 20, 200)))
      const opts = q.providerOptions as JamendoSearchOptions | undefined
      setIfString(url, 'audioformat', opts?.audioformat, ['mp31', 'mp32', 'ogg', 'flac'])
      setIfString(url, 'order', opts?.order, ['relevance', 'popularity_total', 'popularity_month', 'popularity_week', 'releasedate_asc', 'releasedate_desc', 'buzzrate'])
      setIfBoolean(url, 'ccsa', opts?.ccsa)
      setIfBoolean(url, 'ccnd', opts?.ccnd)
      setIfBoolean(url, 'ccnc', opts?.ccnc)
      // jamendo joins tags with a SPACE (not the core default comma).
      setIfStringList(url, 'tags', opts?.tags, { separator: ' ' })
      setIfString(url, 'artist_name', opts?.artist_name)
      // jamendo's offset is non-negative (0 is valid) → setIfNonNegativeInt, not PositiveInt.
      setIfNonNegativeInt(url, 'offset', opts?.offset)
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`jamendo search failed: ${res.status}`)
      const json = (await res.json()) as JamendoResponse
      if (json.headers?.status !== 'success') throw new Error(`jamendo search error: ${json.headers?.error_message || json.headers?.status}`)
      const mediaType = JAMENDO_AUDIO_MIME[opts?.audioformat ?? 'mp31'] ?? 'audio/mpeg'
      return (json.results ?? [])
        .map((t) => toAudioReference(t, mediaType))
        .filter((x): x is Reference => x !== null)
    },
  })
}
