import {
  defineProvider, referenceId, imageMediaType,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

const PH_BASE = 'https://api.polyhaven.com'
const PH_TERMS = 'https://polyhaven.com/license'

export interface PolyHavenConfig {
  /** texture vs HDRI listing. Default 'textures'. */
  assetType?: 'textures' | 'hdris'
  /** Max assets resolved per search; each costs one /files/<id> call (N+1). Default 12. */
  maxAssets?: number
}

interface PolyHavenAsset {
  type: number
  name: string
  categories?: string[]
  tags?: string[]
  authors?: Record<string, string>
  thumbnail_url?: string
}
type PolyHavenList = Record<string, PolyHavenAsset>
// /files tree: maps/resolutions/formats → { url }. Loosely typed; we walk known image paths only.
type PolyHavenFiles = Record<string, unknown>

interface PhFileLeaf { url?: string }

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

function toReference(id: string, asset: PolyHavenAsset, imageUrl: string): Reference {
  const canonical = `https://polyhaven.com/a/${id}`
  const rights: RightsRecord = {
    license: 'CC0-1.0',
    author: firstAuthor(asset.authors),
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: PH_TERMS, sourceUrl: canonical },
  }
  return {
    id: referenceId('polyhaven', canonical),
    modality: 'image',
    title: asset.name || undefined,
    source: { providerId: 'polyhaven', sourceUrl: canonical },
    canonicalUrl: canonical,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(asset.thumbnail_url ? { thumbnail: { url: asset.thumbnail_url } } : {}),
    // textureImageUrl may resolve a .png fallback — derive the MIME from the extension
    // (core imageMediaType) rather than hardcoding jpeg (mislabeling a PNG as JPEG).
    preview: { url: imageUrl, mediaType: imageMediaType(undefined, imageUrl) },
    relevance: 0,
    raw: asset,
  }
}

export function polyhaven(config: PolyHavenConfig = {}) {
  const assetType = config.assetType ?? 'textures'
  return defineProvider({
    id: 'polyhaven',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const listUrl = new URL(`${PH_BASE}/assets`)
      listUrl.searchParams.set('t', assetType)
      const res = await ctx.fetch(listUrl.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`polyhaven list failed: ${res.status}`)
      const list = (await res.json()) as PolyHavenList
      let entries = Object.entries(list)
      // Client-side keyword filter — the list endpoint has no query param.
      const text = q.text?.trim().toLowerCase()
      if (text) {
        entries = entries.filter(([id, a]) =>
          id.includes(text) ||
          a.name?.toLowerCase().includes(text) ||
          a.categories?.some((c) => c.toLowerCase().includes(text)) ||
          a.tags?.some((t) => t.toLowerCase().includes(text)))
      }
      const n = Math.min(config.maxAssets ?? q.limit ?? 12, 30)
      const picked = entries.slice(0, n)
      const refs = await Promise.all(picked.map(async ([id, asset]) => {
        try {
          const fr = await ctx.fetch(`${PH_BASE}/files/${id}`, { signal: ctx.signal })
          if (!fr.ok) return null
          const files = (await fr.json()) as PolyHavenFiles
          const imageUrl = assetType === 'hdris' ? hdriImageUrl(files) : textureImageUrl(files)
          if (!imageUrl) return null // no image-format file → skip (D1)
          return toReference(id, asset, imageUrl)
        } catch {
          return null // one bad files fetch must not drop the whole batch
        }
      }))
      return refs.filter((r): r is Reference => r !== null)
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

function acgToReference(a: AmbientCgAsset, imageUrl: string): Reference {
  const canonical = `https://ambientcg.com/view?id=${a.assetId}`
  const rights: RightsRecord = {
    license: 'CC0-1.0',
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: ACG_TERMS, sourceUrl: canonical },
  }
  return {
    id: referenceId('ambientcg', canonical),
    modality: 'image',
    title: a.displayName || undefined,
    source: { providerId: 'ambientcg', sourceUrl: canonical },
    canonicalUrl: canonical,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: imageUrl },
    preview: { url: imageUrl, mediaType: 'image/png' },
    relevance: 0,
    raw: a,
  }
}

export function ambientcg(config: AmbientCgConfig = {}) {
  return defineProvider({
    id: 'ambientcg',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL(ACG_BASE)
      url.searchParams.set('type', 'Material') // image-based PBR materials only (D1)
      url.searchParams.set('include', 'displayData,imageData')
      url.searchParams.set('limit', String(Math.min(config.limit ?? q.limit ?? 12, 30)))
      if (q.text?.trim()) url.searchParams.set('q', q.text.trim())
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`ambientcg search failed: ${res.status}`)
      const { foundAssets } = (await res.json()) as AmbientCgResponse
      if (!foundAssets || foundAssets.length === 0) return []
      return foundAssets
        .map((a) => {
          // Defensive D1 guard: only Material assets carry an image previewImage.
          if (a.dataType && a.dataType !== 'Material') return null
          const imageUrl = acgPreviewUrl(a.previewImage)
          return imageUrl ? acgToReference(a, imageUrl) : null
        })
        .filter((r): r is Reference => r !== null)
    },
  })
}
