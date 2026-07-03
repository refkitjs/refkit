import {
  defineProvider, referenceId, ccVersionFor,
  setIfString, setIfInt, setIfStringList,
  type Reference, type RightsRecord, type LicenseId, type SearchLicenseControls,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface FlickrConfig {
  apiKey: string
  /** Server-side license filter (comma-separated Flickr license ids). Defaults to the
   *  CC/PD/CC0 set — a relevance hint only; mapFlickrLicense below is authoritative. */
  licenseFilter?: string
}

export interface FlickrSearchOptions {
  licenseFilter?: string
  sort?: 'date-posted-asc' | 'date-posted-desc' | 'date-taken-asc' | 'date-taken-desc' | 'interestingness-desc' | 'interestingness-asc' | 'relevance'
  safeSearch?: 1 | 2 | 3
  tags?: string | readonly string[]
  tagMode?: 'any' | 'all'
  userId?: string
  minUploadDate?: string | number
  maxUploadDate?: string | number
  minTakenDate?: string | number
  maxTakenDate?: string | number
  bbox?: string
  accuracy?: number
  machineTags?: string | readonly string[]
  machineTagMode?: 'any' | 'all'
  groupId?: string
  woeId?: string
  placeId?: string
  hasGeo?: boolean
  geoContext?: 0 | 1 | 2
  lat?: string
  lon?: string
  radius?: number
  radiusUnits?: 'mi' | 'km'
  isCommons?: boolean
  inGallery?: boolean
  isGetty?: boolean
  extras?: string | readonly string[]
  page?: number
  perPage?: number
}

// Flickr numeric license id → our LicenseId (+ CC version). See
// flickr.photos.licenses.getInfo. All Rights Reserved (0) → proprietary; NC/ND
// variants map to their CC families and gate through core's LICENSE_FACTS —
// NC stays denied for commercial/AI use; ND permits verbatim commercial reuse
// (allowed-with-attribution) but stays denied for AI/derivative use.
const FLICKR_LICENSE: Record<number, { license: LicenseId; version?: string }> = {
  0: { license: 'proprietary' },               // All Rights Reserved
  1: { license: 'CC-BY-NC-SA', version: '2.0' },  // CC BY-NC-SA 2.0
  2: { license: 'CC-BY-NC', version: '2.0' },     // CC BY-NC 2.0
  3: { license: 'CC-BY-NC-ND', version: '2.0' },  // CC BY-NC-ND 2.0
  4: { license: 'CC-BY', version: '2.0' },     // CC BY 2.0
  5: { license: 'CC-BY-SA', version: '2.0' },  // CC BY-SA 2.0
  6: { license: 'CC-BY-ND', version: '2.0' },     // CC BY-ND 2.0
  7: { license: 'unknown' },                   // "No known copyright restrictions" — NOT a guaranteed-free grant → needs-review
  8: { license: 'PD' },                        // United States Government Work
  9: { license: 'CC0-1.0' },                   // Public Domain Dedication (CC0)
  10: { license: 'PD' },                       // Public Domain Mark
  11: { license: 'CC-BY', version: '4.0' },    // CC BY 4.0
  12: { license: 'CC-BY-SA', version: '4.0' }, // CC BY-SA 4.0
  13: { license: 'CC-BY-ND', version: '4.0' },    // CC BY-ND 4.0
  14: { license: 'CC-BY-NC', version: '4.0' },    // CC BY-NC 4.0
  15: { license: 'CC-BY-NC-SA', version: '4.0' }, // CC BY-NC-SA 4.0
  16: { license: 'CC-BY-NC-ND', version: '4.0' }, // CC BY-NC-ND 4.0
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

function setIfSafeSearch(url: URL, value: unknown) {
  if (value !== 1 && value !== 2 && value !== 3) return
  url.searchParams.set('safe_search', String(value))
}

function setTags(url: URL, value: unknown) {
  if (typeof value === 'string' && value) url.searchParams.set('tags', value)
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) url.searchParams.set('tags', value.join(','))
}

function setStringOrNumber(url: URL, key: string, value: unknown) {
  if (typeof value === 'string' && value) url.searchParams.set(key, value)
  if (typeof value === 'number' && Number.isFinite(value)) url.searchParams.set(key, String(value))
}

function setBooleanFlag(url: URL, key: string, value: unknown) {
  if (typeof value !== 'boolean') return
  url.searchParams.set(key, value ? '1' : '0')
}

function flickrExtras(value: unknown): string {
  const required = ['license', 'owner_name', 'url_t', 'url_m', 'url_l']
  const extras = new Set(required)
  if (typeof value === 'string') {
    for (const item of value.split(',')) if (item.trim()) extras.add(item.trim())
  }
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
    for (const item of value) if (item) extras.add(item)
  }
  return Array.from(extras).join(',')
}

function flickrLicenseForControls(license: SearchLicenseControls | undefined): string | undefined {
  if (!license) return undefined
  if (license.allowUnknown) return DEFAULT_LICENSE_FILTER
  if (license.commercial && license.modification) return '4,5,9,10,11,12'
  if (license.commercial) return '4,5,6,8,9,10,11,12,13'
  return undefined
}

function flickrSort(sort: string | undefined): string | undefined {
  if (sort === 'interesting') return 'interestingness-desc'
  if (sort === 'latest') return 'date-posted-desc'
  if (sort === 'relevance') return 'relevance'
  return undefined
}

function flickrSafeSearch(safety: string | undefined): 1 | 2 | 3 | undefined {
  if (safety === 'strict') return 1
  if (safety === 'moderate') return 2
  if (safety === 'off') return 3
  return undefined
}

function toReference(p: FlickrPhoto): Reference {
  const { license, version } = mapFlickrLicense(p.license)
  const canonicalUrl = `https://www.flickr.com/photos/${p.owner}/${p.id}`
  const rights: RightsRecord = {
    license,
    licenseVersion: ccVersionFor(license, version),
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
    capabilities: { controls: ['sort', 'safety', 'license.commercial', 'license.modification', 'license.allowUnknown', 'creator.id'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const opts = q.providerOptions as FlickrSearchOptions | undefined
      const url = new URL('https://api.flickr.com/services/rest/')
      url.searchParams.set('method', 'flickr.photos.search')
      url.searchParams.set('api_key', config.apiKey)
      url.searchParams.set('text', q.text)
      url.searchParams.set('license', opts?.licenseFilter ?? flickrLicenseForControls(q.controls?.license) ?? config.licenseFilter ?? DEFAULT_LICENSE_FILTER)
      url.searchParams.set('content_type', '1') // photos only (no screenshots/other)
      url.searchParams.set('media', 'photos')
      url.searchParams.set('sort', 'relevance')
      setIfString(url, 'sort', opts?.sort ?? flickrSort(q.controls?.sort), ['date-posted-asc', 'date-posted-desc', 'date-taken-asc', 'date-taken-desc', 'interestingness-desc', 'interestingness-asc', 'relevance'])
      setIfSafeSearch(url, opts?.safeSearch ?? flickrSafeSearch(q.controls?.safety))
      setTags(url, opts?.tags)
      setIfString(url, 'tag_mode', opts?.tagMode, ['any', 'all'])
      setIfString(url, 'user_id', opts?.userId ?? q.controls?.creator?.id)
      setStringOrNumber(url, 'min_upload_date', opts?.minUploadDate)
      setStringOrNumber(url, 'max_upload_date', opts?.maxUploadDate)
      setStringOrNumber(url, 'min_taken_date', opts?.minTakenDate)
      setStringOrNumber(url, 'max_taken_date', opts?.maxTakenDate)
      setIfString(url, 'bbox', opts?.bbox)
      setIfInt(url, 'accuracy', opts?.accuracy, { min: 1, max: 16 })
      setIfStringList(url, 'machine_tags', opts?.machineTags)
      setIfString(url, 'machine_tag_mode', opts?.machineTagMode, ['any', 'all'])
      setIfString(url, 'group_id', opts?.groupId)
      setIfString(url, 'woe_id', opts?.woeId)
      setIfString(url, 'place_id', opts?.placeId)
      setBooleanFlag(url, 'has_geo', opts?.hasGeo)
      setIfInt(url, 'geo_context', opts?.geoContext, { min: 0, max: 2 })
      setIfString(url, 'lat', opts?.lat)
      setIfString(url, 'lon', opts?.lon)
      setStringOrNumber(url, 'radius', opts?.radius)
      setIfString(url, 'radius_units', opts?.radiusUnits, ['mi', 'km'])
      setBooleanFlag(url, 'is_commons', opts?.isCommons)
      setBooleanFlag(url, 'in_gallery', opts?.inGallery)
      setBooleanFlag(url, 'is_getty', opts?.isGetty)
      url.searchParams.set('extras', flickrExtras(opts?.extras))
      setIfInt(url, 'page', opts?.page, { min: 1 })
      url.searchParams.set('per_page', String(q.limit ?? 20))
      setIfInt(url, 'per_page', opts?.perPage, { min: 1, max: 500 })
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
