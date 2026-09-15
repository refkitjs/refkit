import {
  defineProvider, okJson, first, isLikelyImageUrl, imageMediaType, mapRightsUrl, ccVersionFor,
  type EmittedReference, type RightsRecord,
  type NormalizedQuery, type ProviderContext,
  offsetForPage, setIfNonNegativeInt,
} from '@refkit/core'

const BASE = 'https://api.europeana.eu/record/v2/search.json'

/** Map a Europeana `edm:rights` controlled-vocabulary URI to a core license id (+ CC version,
 *  + jurisdiction for jurisdiction-scoped PD). The `edm:rights` field can be a CC deed OR a
 *  rightsstatements.org statement, so this is exactly core `mapRightsUrl` (CC deeds + faithful
 *  rightsstatements mapping), re-exported under the europeana-specific name the tests import. */
export const mapEuropeanaRights = mapRightsUrl

export interface EuropeanaConfig {
  /** Free BYOK Europeana API key (sent as the `wskey` query param). */
  apiKey: string
}

interface EuropeanaItem {
  id: string
  type?: string
  title?: string[]
  dataProvider?: string[]
  provider?: string[]
  edmPreview?: string[]
  edmIsShownBy?: string[]
  edmIsShownAt?: string[]
  /** MIME type of the media resource when the record declares it. */
  ebucoreHasMimeType?: string[]
  rights?: string[]
}
interface EuropeanaResponse { success?: boolean; items?: EuropeanaItem[] }

// edmIsShownBy is the MEDIA resource; edmIsShownAt is a LANDING PAGE (a web page, not
// an image) — it must never become preview.url. The record usually tells us the media
// type (ebucoreHasMimeType); otherwise fall back to a URL-string heuristic (core
// `isLikelyImageUrl`, no network — `core` never fetches bytes, and a probe would add a
// request per item).

function toReference(it: EuropeanaItem): EmittedReference | null {
  // v1 image-only scope (D1): defensively re-check type even though the search is
  // server-filtered with qf=TYPE:IMAGE.
  if (it.type && it.type !== 'IMAGE') return null
  if (!it.id) return null

  // id is "/datasetId/recordId" (leading slash) → canonical Europeana item page.
  const sourceUrl = `https://www.europeana.eu/item${it.id}`

  // preview = the actual IMAGE media (edmIsShownBy) ONLY — NEVER edmIsShownAt, which is
  // a landing web page. Trust edmIsShownBy when the record's MIME says image/*, or the
  // URL looks like an image, or no MIME contradicts it (type is already IMAGE). thumbnail
  // = edmPreview (Europeana's own thumbnail image service — reliable). Drop the item only
  // when there is neither a usable preview nor a thumbnail (nothing visual to surface).
  const shownBy = first(it.edmIsShownBy)
  const mime = first(it.ebucoreHasMimeType)
  const thumbUrl = first(it.edmPreview)
  const previewUrl = shownBy && (mime?.startsWith('image/') || isLikelyImageUrl(shownBy) || !mime)
    ? shownBy
    : undefined
  if (!previewUrl && !thumbUrl) return null

  const rightsUri = first(it.rights) ?? ''
  const { license, version, jurisdiction } = mapEuropeanaRights(rightsUri)

  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), kept for every versioned CC family —
    // NC stays denied for commercial/AI use; ND allows verbatim commercial reuse
    // (allowed-with-attribution) but stays denied for AI/derivative use.
    licenseVersion: ccVersionFor(license, version),
    // jurisdiction-scoped PD (e.g. NoC-US → PD in the US); metadata for evaluateUse.
    ...(jurisdiction ? { jurisdiction } : {}),
    author: first(it.dataProvider) ?? first(it.provider) ?? undefined,
    // D6: media is hotlinked from data providers — caching/rehosting not permitted.
    rehostPolicy: 'hotlink-required',
    raw: { sourceTerms: rightsUri || 'https://www.europeana.eu/rights', sourceUrl },
  }
  return {
    modality: 'image',
    kind: 'artwork',
    title: first(it.title) || undefined,
    sourceUrl,
    rights,
    ...(thumbUrl ? { thumbnail: { url: thumbUrl } } : {}),
    ...(previewUrl ? { preview: { url: previewUrl, mediaType: imageMediaType(mime, previewUrl) } } : {}),
    raw: it,
  }
}

export function europeana(config: EuropeanaConfig) {
  return defineProvider({
    id: 'europeana',
    modalities: ['image'],
    kinds: ['artwork'],
    description: 'European cultural heritage from museums, libraries and archives (Europeana)',
    capabilities: { controls: ['page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
      const url = new URL(BASE)
      url.searchParams.set('wskey', config.apiKey)
      url.searchParams.set('query', q.text)
      url.searchParams.set('rows', String(q.limit ?? 20))
      // 1-based `start` offset: item index of the first result, not a page number
      setIfNonNegativeInt(url, 'start', offsetForPage(q.controls?.page, q.limit ?? 20, 1))
      url.searchParams.set('media', 'true')   // only items that actually carry media
      url.searchParams.set('qf', 'TYPE:IMAGE') // v1 image-only scope (D1)
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      const json = await okJson<EuropeanaResponse>(res, 'europeana search')
      if (!json.items || json.items.length === 0) return []
      return json.items
        .map(toReference)
        .filter((r): r is EmittedReference => r !== null)
    },
  })
}
