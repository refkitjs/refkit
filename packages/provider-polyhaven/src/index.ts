import {
  defineProvider, okJson, imageMediaType,
  type EmittedReference, type RightsRecord, type NormalizedQuery, type ProviderContext,
  offsetForPage, setIfNonNegativeInt,
} from '@refkit/core'

const PH_BASE = 'https://api.polyhaven.com'
const PH_TERMS = 'https://polyhaven.com/license'

export interface PolyHavenConfig {
  /** texture vs HDRI listing. Default 'textures'. Each is its own source: the
   *  textures listing has the id `polyhaven`, the HDRI listing `polyhaven-hdri`,
   *  so both can be configured side by side. */
  assetType?: 'textures' | 'hdris'
  /** Max assets resolved per search; each costs one /files/<id> call (N+1). Default 12. */
  maxAssets?: number
  /** How long, in ms, this provider instance reuses the asset list it downloaded.
   *  Poly Haven's list endpoint has no query or paging, so every search ranks the
   *  whole list (about 1 MB); caching it saves that download on later searches.
   *  Concurrent searches share one in-flight download, and a failed download is
   *  not cached. Default 3_600_000 (one hour); 0 disables the cache. */
  listTtlMs?: number
}

interface PolyHavenAsset {
  type: number
  name: string
  categories?: string[]
  tags?: string[]
  authors?: Record<string, string>
  thumbnail_url?: string
  download_count?: number
}
type PolyHavenList = Record<string, PolyHavenAsset>

// /files tree: maps/resolutions/formats → { url }. Loosely typed; we walk known image paths only.
type PolyHavenFiles = Record<string, unknown>

interface PhFileLeaf { url?: string }

const DEFAULT_LIST_TTL_MS = 3_600_000

/** Lowercase words of a string, split on anything that isn't alphanumeric — the
 *  rule for both the query tokens and the asset fields they are matched against.
 *  Splitting on punctuation, not just whitespace, keeps "forest, rock." from
 *  gluing a comma onto a token. */
const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** How well an asset matches the query: each token adds its best match only —
 *  3 for a word of the name or id, 2 for a tag or category or a word of one
 *  ("sunset" in `sunrise-sunset`), 1 for a substring of any of those fields,
 *  0 for none. A token that matches nothing (e.g. "hdri") adds 0. */
function relevance(id: string, asset: PolyHavenAsset, tokens: string[]): number {
  const labels = [...(asset.categories ?? []), ...(asset.tags ?? [])]
  const nameWords = new Set([...words(id), ...words(asset.name ?? '')])
  // A token has no separators, so it can equal a whole label only when the label
  // is one word: the label's own words cover both cases.
  const labelWords = new Set(labels.flatMap(words))
  const fields = [id, asset.name ?? '', ...labels].map(f => f.toLowerCase())
  let score = 0
  for (const t of tokens) {
    score += nameWords.has(t) ? 3 : labelWords.has(t) ? 2 : fields.some(f => f.includes(t)) ? 1 : 0
  }
  return score
}

/** Rank the list for a query — the list endpoint has no query param, so this is
 *  the search. Keeps assets that match at least one token and orders them by
 *  score, then download_count, then the list's own (alphabetical) order. A query
 *  with no tokens keeps every asset, so the same order reduces to most-downloaded
 *  first: the alphabetical order means nothing, and it would show the same
 *  `aarfontein_*` assets to every query-less search. */
function rankAssets(list: PolyHavenList, tokens: string[]): [string, PolyHavenAsset][] {
  const downloads = ({ download_count: d }: PolyHavenAsset) => (typeof d === 'number' && Number.isFinite(d) ? d : 0)
  return Object.entries(list)
    .map(([id, asset]) => ({ id, asset, score: relevance(id, asset, tokens) }))
    .filter(e => tokens.length === 0 || e.score > 0)
    // stable sort: equal score and downloads keep the list's own order
    .sort((x, y) => y.score - x.score || downloads(y.asset) - downloads(x.asset))
    .map(e => [e.id, e.asset])
}

/** Settle with `p`, or reject with the signal's reason as soon as it aborts. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** First image URL for a texture: Diffuse (then a couple of fallbacks) → smallest res → jpg/png. */
function textureImageUrl(files: PolyHavenFiles): string | undefined {
  for (const mapKey of ['Diffuse', 'diff', 'Color', 'albedo']) {
    const byRes = files[mapKey] as Record<string, Record<string, PhFileLeaf>> | undefined
    if (!byRes) continue
    for (const res of ['1k', '2k', '4k']) {
      const byFmt = byRes[res]
      const url = byFmt?.jpg?.url ?? byFmt?.png?.url
      if (url) return url
    }
  }
  return undefined
}

/** HDRI image preview: the tonemapped .jpg (skip .hdr/.exr — D1). */
function hdriImageUrl(files: PolyHavenFiles): string | undefined {
  const tm = files.tonemapped as PhFileLeaf | undefined
  return tm?.url
}

function firstAuthor(authors?: Record<string, string>): string | undefined {
  if (!authors) return undefined
  const names = Object.keys(authors)
  return names.length ? names.join(', ') : undefined
}

function toReference(id: string, asset: PolyHavenAsset, imageUrl: string, kind: string): EmittedReference {
  const canonical = `https://polyhaven.com/a/${id}`
  const rights: RightsRecord = {
    license: 'CC0-1.0',
    author: firstAuthor(asset.authors),
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: PH_TERMS, sourceUrl: canonical },
  }
  const tags = [...(asset.categories ?? []), ...(asset.tags ?? [])]
  return {
    modality: 'image',
    kind,
    title: asset.name || undefined,
    ...(tags.length > 0 ? { tags } : {}),
    sourceUrl: canonical,
    rights,
    ...(asset.thumbnail_url ? { thumbnail: { url: asset.thumbnail_url } } : {}),
    // textureImageUrl may resolve a .png fallback — derive the MIME from the extension
    // (core imageMediaType) rather than hardcoding jpeg (mislabeling a PNG as JPEG).
    preview: { url: imageUrl, mediaType: imageMediaType(undefined, imageUrl) },
    raw: asset,
  }
}

export function polyhaven(config: PolyHavenConfig = {}) {
  const assetType = config.assetType ?? 'textures'
  const listTtlMs = config.listTtlMs ?? DEFAULT_LIST_TTL_MS
  const listUrl = new URL(`${PH_BASE}/assets`)
  listUrl.searchParams.set('t', assetType)
  const downloadList = (ctx: ProviderContext, signal?: AbortSignal) =>
    ctx.fetch(listUrl.toString(), { signal }).then(res => okJson<PolyHavenList>(res, 'polyhaven list'))

  // The cached list: an in-flight download until `fetchedAt` is set, fresh for
  // listTtlMs after that.
  let cached: { list: Promise<PolyHavenList>; fetchedAt?: number } | undefined
  const assetList = (ctx: ProviderContext): Promise<PolyHavenList> => {
    if (!(listTtlMs > 0)) return downloadList(ctx, ctx.signal)
    if (!cached || (cached.fetchedAt !== undefined && Date.now() - cached.fetchedAt >= listTtlMs)) {
      // Download WITHOUT this search's signal and race the signal per caller
      // instead: an aborted search rejects at once but cannot fail the download
      // other searches share, and a download that outlives the deadline of the
      // search that started it still lands in the cache for the next search.
      const entry: NonNullable<typeof cached> = { list: downloadList(ctx) }
      cached = entry
      entry.list.then(
        () => { entry.fetchedAt = Date.now() },
        () => { if (cached === entry) cached = undefined }, // a failed download is not cached
      )
    }
    return raceAbort(cached.list, ctx.signal)
  }

  return defineProvider({
    id: assetType === 'hdris' ? 'polyhaven-hdri' : 'polyhaven',
    modalities: ['image'],
    kinds: assetType === 'hdris' ? ['hdri'] : ['texture'],
    description: assetType === 'hdris'
      ? 'CC0 HDRI environments for 3D lighting (Poly Haven)'
      : 'CC0 PBR textures for 3D work (Poly Haven)',
    capabilities: { controls: ['page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
      // Client-side ranking — the list endpoint has no query param. Match PER
      // TOKEN, not on the whole phrase: asset metadata is single-word (id, name,
      // categories, tags), so "forest rock" as one substring matches nothing
      // while both of its words describe real assets. The ranking must happen
      // here, before the maxAssets window: core reranks only what we return.
      const entries = rankAssets(await assetList(ctx), words(q.text ?? ''))
      const n = Math.min(config.maxAssets ?? q.limit ?? 12, 30)
      // the list endpoint returns everything — page = a window over the ranked list
      const from = offsetForPage(q.controls?.page, n) ?? 0
      const picked = entries.slice(from, from + n)
      const refs = await Promise.all(picked.map(async ([id, asset]) => {
        try {
          const fr = await ctx.fetch(`${PH_BASE}/files/${id}`, { signal: ctx.signal })
          if (!fr.ok) return null
          const files = (await fr.json()) as PolyHavenFiles
          const imageUrl = assetType === 'hdris' ? hdriImageUrl(files) : textureImageUrl(files)
          if (!imageUrl) return null // no image-format file → skip (D1)
          return toReference(id, asset, imageUrl, assetType === 'hdris' ? 'hdri' : 'texture')
        } catch {
          return null // one bad files fetch must not drop the whole batch
        }
      }))
      return refs.filter((r): r is EmittedReference => r !== null)
    },
  })
}

const ACG_BASE = 'https://ambientcg.com/api/v2/full_json'
const ACG_TERMS = 'https://ambientcg.com/license/'

export interface AmbientCgConfig {
  /** Max materials per search. Default 12. */
  limit?: number
}

interface AmbientCgAsset {
  assetId: string
  displayName?: string
  dataType?: string
  previewImage?: Record<string, string>
}
interface AmbientCgResponse { foundAssets?: AmbientCgAsset[] }

/** Pick the largest available PNG preview (image-format only — D1). */
function acgPreviewUrl(preview?: Record<string, string>): string | undefined {
  if (!preview) return undefined
  for (const key of ['1024-PNG', '512-PNG', '256-PNG', '128-PNG']) {
    if (preview[key]) return preview[key]
  }
  return undefined
}

function acgToReference(a: AmbientCgAsset, imageUrl: string): EmittedReference {
  const canonical = `https://ambientcg.com/view?id=${a.assetId}`
  const rights: RightsRecord = {
    license: 'CC0-1.0',
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: ACG_TERMS, sourceUrl: canonical },
  }
  return {
    modality: 'image',
    kind: 'texture',
    title: a.displayName || undefined,
    sourceUrl: canonical,
    rights,
    thumbnail: { url: imageUrl },
    preview: { url: imageUrl, mediaType: 'image/png' },
    raw: a,
  }
}

export function ambientcg(config: AmbientCgConfig = {}) {
  return defineProvider({
    id: 'ambientcg',
    modalities: ['image'],
    kinds: ['texture'],
    description: 'CC0 PBR materials and textures (ambientCG)',
    capabilities: { controls: ['page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
      const url = new URL(ACG_BASE)
      url.searchParams.set('type', 'Material') // image-based PBR materials only (D1)
      url.searchParams.set('include', 'displayData,imageData')
      const pageSize = Math.min(config.limit ?? q.limit ?? 12, 30)
      url.searchParams.set('limit', String(pageSize))
      // offset-based API: translate the 1-based page control
      setIfNonNegativeInt(url, 'offset', offsetForPage(q.controls?.page, pageSize))
      if (q.text?.trim()) url.searchParams.set('q', q.text.trim())
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      const { foundAssets } = await okJson<AmbientCgResponse>(res, 'ambientcg search')
      if (!foundAssets || foundAssets.length === 0) return []
      return foundAssets
        .map((a) => {
          // Defensive D1 guard: only Material assets carry an image previewImage.
          if (a.dataType && a.dataType !== 'Material') return null
          const imageUrl = acgPreviewUrl(a.previewImage)
          return imageUrl ? acgToReference(a, imageUrl) : null
        })
        .filter((r): r is EmittedReference => r !== null)
    },
  })
}
