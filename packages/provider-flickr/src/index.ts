import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface FlickrConfig {
  apiKey: string
  /** Server-side license filter (comma-separated Flickr license ids). Defaults to the
   *  CC/PD/CC0 set — a relevance hint only; mapFlickrLicense below is authoritative. */
  licenseFilter?: string
}

// Flickr numeric license id → our LicenseId (+ CC version). See
// flickr.photos.licenses.getInfo. All Rights Reserved (0) and every NC/ND
// variant map to 'proprietary' (→ denied for commercial/AI use).
const FLICKR_LICENSE: Record<number, { license: LicenseId; version?: string }> = {
  0: { license: 'proprietary' },               // All Rights Reserved
  1: { license: 'proprietary' },               // CC BY-NC-SA 2.0
  2: { license: 'proprietary' },               // CC BY-NC 2.0
  3: { license: 'proprietary' },               // CC BY-NC-ND 2.0
  4: { license: 'CC-BY', version: '2.0' },     // CC BY 2.0
  5: { license: 'CC-BY-SA', version: '2.0' },  // CC BY-SA 2.0
  6: { license: 'proprietary' },               // CC BY-ND 2.0
  7: { license: 'PD' },                        // No known copyright restrictions
  8: { license: 'PD' },                        // United States Government Work
  9: { license: 'CC0-1.0' },                   // Public Domain Dedication (CC0)
  10: { license: 'PD' },                       // Public Domain Mark
  11: { license: 'CC-BY', version: '4.0' },    // CC BY 4.0
  12: { license: 'CC-BY-SA', version: '4.0' }, // CC BY-SA 4.0
  13: { license: 'proprietary' },              // CC BY-ND 4.0
  14: { license: 'proprietary' },              // CC BY-NC 4.0
  15: { license: 'proprietary' },              // CC BY-NC-SA 4.0
  16: { license: 'proprietary' },              // CC BY-NC-ND 4.0
}

/** Map a Flickr numeric license id (string or number) to our license + CC version. */
export function mapFlickrLicense(id: string | number): { license: LicenseId; version?: string } {
  const n = typeof id === 'string' ? Number(id) : id
  return FLICKR_LICENSE[n] ?? { license: 'unknown' }
}

// Usable-license relevance hint (CC-BY/BY-SA 2.0+4.0, PD ×3, CC0). Flickr is mostly
// All-Rights-Reserved, so without this most results would gate straight to denied.
const DEFAULT_LICENSE_FILTER = '4,5,7,8,9,10,11,12'

interface FlickrPhoto {
  id: string
  owner: string
  title: string
  license: string
  ownername?: string
  url_t?: string; width_t?: number; height_t?: number
  url_m?: string; width_m?: number; height_m?: number
  url_l?: string; width_l?: number; height_l?: number
}
interface FlickrResponse { photos?: { photo: FlickrPhoto[] }; stat: string }

function toReference(p: FlickrPhoto): Reference {
  const { license, version } = mapFlickrLicense(p.license)
  const canonicalUrl = `https://www.flickr.com/photos/${p.owner}/${p.id}`
  const rights: RightsRecord = {
    license,
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
    author: p.ownername || undefined,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://www.flickr.com/help/terms', sourceUrl: canonicalUrl },
  }
  const previewUrl = p.url_l ?? p.url_m
  const previewW = p.url_l ? p.width_l : p.width_m
  const previewH = p.url_l ? p.height_l : p.height_m
  const thumbUrl = p.url_t ?? p.url_m
  return {
    id: referenceId('flickr', canonicalUrl),
    modality: 'image',
    title: p.title || undefined,
    source: { providerId: 'flickr', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(thumbUrl ? { thumbnail: { url: thumbUrl } } : {}),
    ...(previewUrl ? { preview: { url: previewUrl, mediaType: 'image/jpeg', width: previewW, height: previewH } } : {}),
    ...(previewW && previewH ? { visual: { width: previewW, height: previewH } } : {}),
    relevance: 0,
    raw: p,
  }
}

export function flickr(config: FlickrConfig) {
  return defineProvider({
    id: 'flickr',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.flickr.com/services/rest/')
      url.searchParams.set('method', 'flickr.photos.search')
      url.searchParams.set('api_key', config.apiKey)
      url.searchParams.set('text', q.text)
      url.searchParams.set('license', config.licenseFilter ?? DEFAULT_LICENSE_FILTER)
      url.searchParams.set('content_type', '1') // photos only (no screenshots/other)
      url.searchParams.set('media', 'photos')
      url.searchParams.set('sort', 'relevance')
      url.searchParams.set('extras', 'license,owner_name,url_t,url_m,url_l')
      url.searchParams.set('per_page', String(q.limit ?? 20))
      url.searchParams.set('format', 'json')
      url.searchParams.set('nojsoncallback', '1')
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`flickr search failed: ${res.status}`)
      const json = (await res.json()) as FlickrResponse
      if (json.stat !== 'ok' || !json.photos) throw new Error(`flickr search error: stat=${json.stat}`)
      return json.photos.photo.map(toReference)
    },
  })
}
