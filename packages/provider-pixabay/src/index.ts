import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface PixabayConfig { key: string }

export interface PixabayImageSearchOptions {
  lang?: string
  id?: string
  imageType?: 'all' | 'photo' | 'illustration' | 'vector'
  orientation?: 'all' | 'horizontal' | 'vertical'
  category?: string
  minWidth?: number
  minHeight?: number
  colors?: string | readonly string[]
  safesearch?: boolean
  order?: 'popular' | 'latest'
  editorsChoice?: boolean
  page?: number
  perPage?: number
}

export interface PixabayVideoSearchOptions {
  lang?: string
  id?: string
  videoType?: 'all' | 'film' | 'animation'
  category?: string
  minWidth?: number
  minHeight?: number
  safesearch?: boolean
  order?: 'popular' | 'latest'
  editorsChoice?: boolean
  page?: number
  perPage?: number
}

interface PixabayHit {
  id: number
  tags: string
  user: string
  pageURL: string
  previewURL: string
  previewWidth: number
  previewHeight: number
  webformatURL: string
  largeImageURL: string
  imageWidth: number
  imageHeight: number
}
interface PixabayResponse { hits: PixabayHit[] }

function setIfString(url: URL, key: string, value: unknown, allowed?: readonly string[]) {
  if (typeof value !== 'string') return
  if (allowed && !allowed.includes(value)) return
  url.searchParams.set(key, value)
}

function setIfStringList(url: URL, key: string, value: unknown, allowed?: readonly string[]) {
  if (typeof value === 'string') {
    if (!value) return
    if (allowed && !value.split(',').every(v => allowed.includes(v))) return
    url.searchParams.set(key, value)
  }
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
    if (allowed && !value.every(v => allowed.includes(v))) return
    url.searchParams.set(key, value.join(','))
  }
}

function setIfNonNegativeInt(url: URL, key: string, value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return
  url.searchParams.set(key, String(value))
}

function setIfPositiveInt(url: URL, key: string, value: unknown, options?: { min?: number; max?: number }) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < (options?.min ?? 1)) return
  url.searchParams.set(key, String(Math.min(value, options?.max ?? value)))
}

function setIfBoolean(url: URL, key: string, value: unknown) {
  if (typeof value !== 'boolean') return
  url.searchParams.set(key, String(value))
}

function useLegacyFilter<T>(control: T | undefined, legacy: T | undefined): T | undefined {
  return control === undefined ? legacy : undefined
}

function pixabayOrientation(orientation: string | undefined): string | undefined {
  if (orientation === 'landscape') return 'horizontal'
  if (orientation === 'portrait') return 'vertical'
  return undefined
}

function toReference(h: PixabayHit): Reference {
  const rights: RightsRecord = {
    license: 'pixabay',
    author: h.user,
    rehostPolicy: 'cache-allowed', // Pixabay forbids hotlinking; webformatURL valid 24h → must cache
    raw: { sourceTerms: 'https://pixabay.com/service/license-summary/', sourceUrl: h.pageURL },
  }
  return {
    id: referenceId('pixabay', h.pageURL),
    modality: 'image',
    title: h.tags || undefined, // no title field; tags is the only descriptive text
    source: { providerId: 'pixabay', sourceUrl: h.pageURL },
    canonicalUrl: h.pageURL,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: h.previewURL, width: h.previewWidth, height: h.previewHeight },
    visual: { width: h.imageWidth, height: h.imageHeight },
    relevance: 0,
    raw: h,
  }
}

export function pixabay(config: PixabayConfig) {
  return defineProvider({
    id: 'pixabay',
    modalities: ['image'],
    queryFeatures: ['keyword', 'color', 'orientation', 'language'],
    capabilities: { controls: ['orientation', 'color', 'language', 'sort', 'safety', 'media.kind', 'media.minWidth', 'media.minHeight'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://pixabay.com/api/')
      url.searchParams.set('key', config.key)
      url.searchParams.set('q', q.text)
      url.searchParams.set('image_type', 'photo')
      url.searchParams.set('per_page', String(Math.min(Math.max(q.limit ?? 20, 3), 200)))
      if (q.controls?.language) url.searchParams.set('lang', q.controls.language)
      if (q.controls?.color) url.searchParams.set('colors', q.controls.color)
      const controlsOrientation = pixabayOrientation(q.controls?.orientation)
      if (controlsOrientation) url.searchParams.set('orientation', controlsOrientation)
      if (q.controls?.sort === 'latest' || q.controls?.sort === 'popular') url.searchParams.set('order', q.controls.sort)
      if (q.controls?.safety === 'strict') url.searchParams.set('safesearch', 'true')
      if (q.controls?.safety === 'off') url.searchParams.set('safesearch', 'false')
      if (q.controls?.media?.kind === 'photo' || q.controls?.media?.kind === 'illustration' || q.controls?.media?.kind === 'vector') {
        url.searchParams.set('image_type', q.controls.media.kind)
      }
      if (q.controls?.media?.minWidth !== undefined) url.searchParams.set('min_width', String(q.controls.media.minWidth))
      if (q.controls?.media?.minHeight !== undefined) url.searchParams.set('min_height', String(q.controls.media.minHeight))
      const legacyLanguage = useLegacyFilter(q.controls?.language, q.filters?.language)
      if (legacyLanguage) url.searchParams.set('lang', legacyLanguage)
      const legacyColor = useLegacyFilter(q.controls?.color, q.filters?.color)
      if (legacyColor) url.searchParams.set('colors', legacyColor)
      const orientation = pixabayOrientation(useLegacyFilter(q.controls?.orientation, q.filters?.orientation))
      if (orientation) url.searchParams.set('orientation', orientation)
      const opts = q.providerOptions as PixabayImageSearchOptions | undefined
      setIfString(url, 'lang', opts?.lang)
      setIfString(url, 'id', opts?.id)
      setIfString(url, 'image_type', opts?.imageType, ['all', 'photo', 'illustration', 'vector'])
      setIfString(url, 'orientation', opts?.orientation, ['all', 'horizontal', 'vertical'])
      setIfString(url, 'category', opts?.category)
      setIfNonNegativeInt(url, 'min_width', opts?.minWidth)
      setIfNonNegativeInt(url, 'min_height', opts?.minHeight)
      setIfStringList(url, 'colors', opts?.colors, ['grayscale', 'transparent', 'red', 'orange', 'yellow', 'green', 'turquoise', 'blue', 'lilac', 'pink', 'white', 'gray', 'black', 'brown'])
      setIfBoolean(url, 'safesearch', opts?.safesearch)
      setIfString(url, 'order', opts?.order, ['popular', 'latest'])
      setIfBoolean(url, 'editors_choice', opts?.editorsChoice)
      setIfPositiveInt(url, 'page', opts?.page)
      setIfPositiveInt(url, 'per_page', opts?.perPage, { min: 3, max: 200 })
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`pixabay search failed: ${res.status}`)
      const json = (await res.json()) as PixabayResponse
      return json.hits.map(toReference)
    },
  })
}

interface PixabayVideoSize { url: string; width: number; height: number; size: number; thumbnail?: string }
interface PixabayVideoHit {
  id: number
  pageURL: string
  tags: string
  duration: number
  user: string
  videos: { large?: PixabayVideoSize; medium?: PixabayVideoSize; small?: PixabayVideoSize; tiny?: PixabayVideoSize }
}
interface PixabayVideoResponse { hits: PixabayVideoHit[] }

function toVideoReference(h: PixabayVideoHit): Reference | null {
  const v = h.videos.large ?? h.videos.medium ?? h.videos.small ?? h.videos.tiny
  if (!v) return null // no usable rendition → skip rather than emit a preview-less reference
  const rights: RightsRecord = {
    license: 'pixabay',
    author: h.user,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://pixabay.com/service/license-summary/', sourceUrl: h.pageURL },
  }
  return {
    id: referenceId('pixabay-video', h.pageURL),
    modality: 'video',
    title: h.tags || undefined,
    source: { providerId: 'pixabay-video', sourceUrl: h.pageURL },
    canonicalUrl: h.pageURL,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(v.thumbnail ? { thumbnail: { url: v.thumbnail } } : {}),
    preview: { url: v.url, mediaType: 'video/mp4', width: v.width, height: v.height },
    visual: { width: v.width, height: v.height },
    relevance: 0,
    raw: h,
  }
}

// Pixabay's video catalogue under the same key — the cheap video leg.
export function pixabayVideo(config: PixabayConfig) {
  return defineProvider({
    id: 'pixabay-video',
    modalities: ['video'],
    queryFeatures: ['keyword', 'language'],
    capabilities: { controls: ['language', 'sort', 'safety', 'media.kind', 'media.minWidth', 'media.minHeight'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://pixabay.com/api/videos/')
      url.searchParams.set('key', config.key)
      url.searchParams.set('q', q.text)
      url.searchParams.set('per_page', String(Math.min(Math.max(q.limit ?? 20, 3), 200)))
      if (q.controls?.language) url.searchParams.set('lang', q.controls.language)
      if (q.controls?.sort === 'latest' || q.controls?.sort === 'popular') url.searchParams.set('order', q.controls.sort)
      if (q.controls?.safety === 'strict') url.searchParams.set('safesearch', 'true')
      if (q.controls?.safety === 'off') url.searchParams.set('safesearch', 'false')
      if (q.controls?.media?.kind === 'film' || q.controls?.media?.kind === 'animation') {
        url.searchParams.set('video_type', q.controls.media.kind)
      }
      if (q.controls?.media?.minWidth !== undefined) url.searchParams.set('min_width', String(q.controls.media.minWidth))
      if (q.controls?.media?.minHeight !== undefined) url.searchParams.set('min_height', String(q.controls.media.minHeight))
      const legacyLanguage = useLegacyFilter(q.controls?.language, q.filters?.language)
      if (legacyLanguage) url.searchParams.set('lang', legacyLanguage)
      const opts = q.providerOptions as PixabayVideoSearchOptions | undefined
      setIfString(url, 'lang', opts?.lang)
      setIfString(url, 'id', opts?.id)
      setIfString(url, 'video_type', opts?.videoType, ['all', 'film', 'animation'])
      setIfString(url, 'category', opts?.category)
      setIfNonNegativeInt(url, 'min_width', opts?.minWidth)
      setIfNonNegativeInt(url, 'min_height', opts?.minHeight)
      setIfBoolean(url, 'safesearch', opts?.safesearch)
      setIfString(url, 'order', opts?.order, ['popular', 'latest'])
      setIfBoolean(url, 'editors_choice', opts?.editorsChoice)
      setIfPositiveInt(url, 'page', opts?.page)
      setIfPositiveInt(url, 'per_page', opts?.perPage, { min: 3, max: 200 })
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`pixabay video search failed: ${res.status}`)
      const json = (await res.json()) as PixabayVideoResponse
      return json.hits.map(toVideoReference).filter((r): r is Reference => r !== null)
    },
  })
}
