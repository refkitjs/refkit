import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface NailbookConfig {
  /** Override the browser-like User-Agent sent with the search request. nailbook's
   *  edge serves data to browser-shaped clients; the default mirrors a desktop
   *  browser. Rarely needed. */
  userAgent?: string
}

// nailbook.jp is a client-rendered SPA. Its /design/ list page embeds only a thin
// bootstrap (<script> App.renderTo(...)) that carries photo IDs but NO image URLs —
// the gallery tiles are fetched client-side from this JSON endpoint, which the site's
// own frontend POSTs to. We call it directly: one request returns full photo objects
// (image CDN base_url + dimensions, caption, tags, author), which is both cleaner than
// scraping HTML and the only source that actually contains the image URLs. See README.
const SEARCH_ENDPOINT = 'https://nailbook.jp/api/web/photo/search'

// The `images[].base_url` ends in a slash; appending a size token yields a real JPEG.
// Verified variants (all `image/jpeg`): `320_lc` ~30KB (thumbnail), `1280_lc` ~370KB
// (preview). The token is `${longEdgePx}_lc`.
const THUMB_VARIANT = '320_lc'
const PREVIEW_VARIANT = '1280_lc'

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

interface NailbookVideo { width: number; height: number; duration: number; url: string }
interface NailbookImage {
  width: number
  height: number
  base_url: string
  video: NailbookVideo | null
  video_url: string | null
}
interface NailbookUser { id: number; display_name: string | null }
interface NailbookTag { id: number; name: string }
interface NailbookPhoto {
  id: number
  memo: string | null
  price: number | null
  kawaii_count: number
  create_datetime: string
  images: NailbookImage[]
  user: NailbookUser | null
  tags: NailbookTag[]
}
interface NailbookSearchResponse {
  data?: { total_count: number; scrolling_key: string | null; items: NailbookPhoto[] }
  result: boolean
  status_code: number
}

/** A human-readable title from the photo's caption. `memo` is free text that
 *  usually opens with a descriptive line and trails into a block of hashtags;
 *  take the first line carrying non-hashtag text, capped for display. Falls back
 *  to the tag labels, then to nothing (title is optional). */
function pickTitle(photo: NailbookPhoto): string | undefined {
  for (const raw of (photo.memo ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // a line that is only hashtags (`#foo ＃bar`, both ASCII and fullwidth) has no title text
    if (!line.replace(/[#＃]\S+/g, '').trim()) continue
    return line.length > 80 ? `${line.slice(0, 79)}…` : line
  }
  const tags = photo.tags.map(t => t.name).filter(Boolean)
  return tags.length > 0 ? tags.join(' / ') : undefined
}

function toReference(photo: NailbookPhoto): Reference | null {
  // images[0] is always the primary still (even when a later image carries a video);
  // no primary image → nothing to surface.
  const image = photo.images?.[0]
  if (!image?.base_url) return null
  const canonicalUrl = `https://nailbook.jp/design/${photo.id}/`
  const rights: RightsRecord = {
    // Discovery source: user-posted nail-design photos with no per-item license
    // metadata, so evaluateUse returns needs-review (never auto-allowed). Only the
    // resized CDN thumbnail is safe to surface — never rehost the original.
    license: 'unknown',
    author: photo.user?.display_name ?? undefined,
    rehostPolicy: 'thumbnail-only',
    raw: { sourceTerms: '', sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('nailbook', canonicalUrl),
    modality: 'image',
    title: pickTitle(photo),
    source: { providerId: 'nailbook', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    // thumbnail/preview are resized variants; their pixel dims aren't known here.
    // `visual` carries the original asset dimensions.
    thumbnail: { url: image.base_url + THUMB_VARIANT },
    preview: { url: image.base_url + PREVIEW_VARIANT, mediaType: 'image/jpeg' },
    visual: { width: image.width, height: image.height },
    relevance: 0, // per-source order; mergeReferences assigns the final RRF relevance
    raw: photo,
  }
}

export function nailbook(config: NailbookConfig = {}) {
  return defineProvider({
    id: 'nailbook',
    modalities: ['image'],
    // No search controls: the endpoint's `page` param is a no-op (verified — page 2
    // returns the same head-of-results as page 1, shifted only by newly-posted photos;
    // real pagination needs a stateful `scrolling_key` search_after cursor that doesn't
    // map onto the stateless `controls.page` model). One request per search, by design.
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const res = await ctx.fetch(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          // Content-Type: application/json is load-bearing — any other/absent type is
          // rejected with HTTP 400 `nb.unacceptable_request_encoding` (verified). The
          // rest mirror the site's own XHR so its edge returns data, not a JS shell.
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': config.userAgent ?? DEFAULT_UA,
        },
        body: JSON.stringify({ keyword: q.text }),
        signal: ctx.signal,
      })
      if (!res.ok) throw new Error(`nailbook search failed: ${res.status}`)
      const json = (await res.json()) as NailbookSearchResponse
      const refs = (json.data?.items ?? [])
        .map(toReference)
        .filter((r): r is Reference => r !== null)
      return typeof q.limit === 'number' && q.limit > 0 ? refs.slice(0, q.limit) : refs
    },
  })
}
