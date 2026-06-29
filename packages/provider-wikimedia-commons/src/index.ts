import {
  defineProvider, referenceId,
  setIfString, setIfNonNegativeInt, setIfPositiveInt, setIfBoolean,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface WikimediaCommonsConfig {
  /** Width (px) of the thumbnail rendition requested from the API. Default 1024. */
  thumbWidth?: number
}

export interface WikimediaCommonsSearchOptions {
  gsrlimit?: number
  gsroffset?: number
  gsrqiprofile?: string
  gsrqdprofile?: string
  gsrwhat?: 'nearmatch' | 'text' | 'title'
  gsrinfo?: string | readonly string[]
  gsrprop?: string | readonly string[]
  gsrinterwiki?: boolean
  gsrenablerewrites?: boolean
  gsrsort?: string
  iiprop?: string | readonly string[]
  iiurlwidth?: number
  iiextmetadatafilter?: string | readonly string[]
}

// Map a Wikimedia Commons extmetadata `License` code (e.g. "cc-by-sa-4.0", "cc0",
// "pd-old") to our LicenseId + CC version. NC/ND variants → 'proprietary'; anything
// unrecognized — including non-free / fair-use files — → 'unknown' (strict-deny →
// needs-review), so we never present unclear-rights media as reusable.
export function mapCommonsLicense(code: string | undefined): { license: LicenseId; version?: string } {
  const c = (code ?? '').trim().toLowerCase()
  if (!c) return { license: 'unknown' }
  if (c === 'cc0' || c.startsWith('cc0-')) return { license: 'CC0-1.0' }
  if (c.includes('-nc') || c.includes('-nd')) return { license: 'proprietary' }
  // tolerate jurisdiction ports (e.g. cc-by-sa-2.5-in, cc-by-3.0-us) — same permission family
  const sa = c.match(/^cc-by-sa-(\d+\.\d+)(?:-[a-z]{2,})?$/)
  if (sa) return { license: 'CC-BY-SA', version: sa[1] }
  const by = c.match(/^cc-by-(\d+\.\d+)(?:-[a-z]{2,})?$/)
  if (by) return { license: 'CC-BY', version: by[1] }
  if (c === 'pd' || c.startsWith('pd-') || c.startsWith('public') || c.includes('publicdomain')) {
    return { license: 'PD' }
  }
  return { license: 'unknown' }
}

interface ExtMeta { value: string; source?: string }
interface CommonsImageInfo {
  url: string
  descriptionurl: string
  mime?: string
  width?: number
  height?: number
  thumburl?: string
  thumbwidth?: number
  thumbheight?: number
  extmetadata?: Record<string, ExtMeta>
}
interface CommonsPage {
  pageid: number
  ns?: number
  title: string
  index?: number
  imageinfo?: CommonsImageInfo[]
}
interface CommonsResponse { query?: { pages?: Record<string, CommonsPage> } }

const emVal = (em: Record<string, ExtMeta> | undefined, key: string): string | undefined => em?.[key]?.value

// extmetadata Artist/ObjectName routinely embed HTML (anchor tags, spans). Strip to text.
function stripTags(s: string | undefined): string | undefined {
  if (s == null) return undefined
  const text = s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return text || undefined
}

// ObjectName usually holds a clean caption, but for some files (often old-master
// scans) it carries Structured-Data multilingual label markup ("… title QS:P1476,
// de:…") instead. Fall back to the file name (sans "File:" prefix and extension) then.
function pickTitle(objectName: string | undefined, pageTitle: string): string | undefined {
  const name = stripTags(objectName)
  if (name && !name.includes('QS:')) return name
  return stripTags(pageTitle.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''))
}

function toReference(page: CommonsPage): Reference | null {
  const info = page.imageinfo?.[0]
  if (!info) return null
  const { license, version } = mapCommonsLicense(emVal(info.extmetadata, 'License'))
  const author = stripTags(emVal(info.extmetadata, 'Artist'))
  const title = pickTitle(emVal(info.extmetadata, 'ObjectName'), page.title)
  const rights: RightsRecord = {
    license,
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
    author: author || undefined,
    rehostPolicy: 'cache-allowed',
    raw: {
      sourceTerms: emVal(info.extmetadata, 'LicenseUrl') ?? info.descriptionurl,
      sourceUrl: info.descriptionurl,
    },
  }
  return {
    id: referenceId('wikimedia-commons', info.descriptionurl),
    modality: 'image',
    title,
    source: { providerId: 'wikimedia-commons', sourceUrl: info.descriptionurl },
    canonicalUrl: info.descriptionurl,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(info.thumburl ? { thumbnail: { url: info.thumburl, width: info.thumbwidth, height: info.thumbheight } } : {}),
    preview: { url: info.url, mediaType: info.mime ?? 'image/jpeg', width: info.width, height: info.height },
    ...(info.width && info.height ? { visual: { width: info.width, height: info.height } } : {}),
    relevance: 0,
    raw: page,
  }
}

function setPipeList(url: URL, key: string, value: unknown) {
  if (typeof value === 'string' && value) url.searchParams.set(key, value)
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) url.searchParams.set(key, value.join('|'))
}

function commonsImageInfoProps(value: unknown): string {
  const props = new Set(['url', 'mime', 'size', 'extmetadata'])
  if (typeof value === 'string') {
    for (const item of value.split('|')) if (item.trim()) props.add(item.trim())
  }
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
    for (const item of value) if (item) props.add(item)
  }
  return Array.from(props).join('|')
}

export function wikimediaCommons(config: WikimediaCommonsConfig = {}) {
  return defineProvider({
    id: 'wikimedia-commons',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://commons.wikimedia.org/w/api.php')
      url.searchParams.set('action', 'query')
      url.searchParams.set('format', 'json')
      url.searchParams.set('generator', 'search')
      url.searchParams.set('gsrsearch', `${q.text} filetype:bitmap`) // raster images only
      url.searchParams.set('gsrnamespace', '6') // File:
      url.searchParams.set('gsrlimit', String(q.limit ?? 20))
      url.searchParams.set('prop', 'imageinfo')
      url.searchParams.set('iiprop', 'url|mime|size|extmetadata')
      url.searchParams.set('iiurlwidth', String(config.thumbWidth ?? 1024))
      const opts = q.providerOptions as WikimediaCommonsSearchOptions | undefined
      setIfPositiveInt(url, 'gsrlimit', opts?.gsrlimit, { max: 500, clamp: true })
      setIfNonNegativeInt(url, 'gsroffset', opts?.gsroffset)
      setIfString(url, 'gsrqiprofile', opts?.gsrqiprofile)
      setIfString(url, 'gsrqdprofile', opts?.gsrqdprofile)
      setIfString(url, 'gsrwhat', opts?.gsrwhat, ['nearmatch', 'text', 'title'])
      setPipeList(url, 'gsrinfo', opts?.gsrinfo)
      setPipeList(url, 'gsrprop', opts?.gsrprop)
      setIfBoolean(url, 'gsrinterwiki', opts?.gsrinterwiki)
      setIfBoolean(url, 'gsrenablerewrites', opts?.gsrenablerewrites)
      setIfString(url, 'gsrsort', opts?.gsrsort)
      url.searchParams.set('iiprop', commonsImageInfoProps(opts?.iiprop))
      setIfPositiveInt(url, 'iiurlwidth', opts?.iiurlwidth)
      setPipeList(url, 'iiextmetadatafilter', opts?.iiextmetadatafilter)
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`wikimedia-commons search failed: ${res.status}`)
      const json = (await res.json()) as CommonsResponse
      const pages = json.query?.pages
      if (!pages) return [] // no results (the search generator omits `pages` entirely)
      return Object.values(pages)
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) // preserve search rank for RRF
        .map(toReference)
        .filter((r): r is Reference => r !== null)
    },
  })
}
