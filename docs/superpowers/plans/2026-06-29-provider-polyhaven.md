# Poly Haven + ambientCG Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan **builds on** `2026-06-29-p1-providers-index.md` — read it first. Where this plan says "Execute Shared Task S0/S9", run that task from the index with the substitutions given here; do **not** re-paste the index boilerplate.

**Goal:** Add `@refkit/provider-polyhaven` — a single keyless satellite package exposing **two factories**, `polyhaven()` (Poly Haven) and `ambientcg()` (ambientCG), that return license-normalized `image` `Reference`s. Both sources are wholly CC0; every emitted reference is hardcoded to `license: 'CC0-1.0'`.

**Architecture:**
- **Two factories, one package** (mirrors `pexels` + `pexelsVideo` living together in `@refkit/provider-pexels`). `polyhaven()` and `ambientcg()` are independent `defineProvider(...)` instances exported from the same `src/index.ts`; they share the CC0 `toReference` shape but hit different APIs.
- **D1 — modality ceiling (image only, skip 3D):** core defines exactly `image | video | audio | text` (no `3d`/`texture`). Both sources host textures/HDRIs as **image files**, so we emit `modality: 'image'`. We surface only the image-format preview per asset and **skip 3D model formats** (`.blend`/`.gltf`/`.fbx`/`.mtlx`/`.usd`) for v1 — no core change, no `3d` modality. The README must document this skip.
- **D2 — whole-source CC0 hardcode:** neither API exposes a per-item license field. We hardcode `license: 'CC0-1.0'`, `rehostPolicy: 'cache-allowed'`, and `rights.raw.sourceTerms = <license page URL>`. No `licenseVersion`, no per-item license parsing. Mirror `provider-met`'s hardcoded-CC0 shape exactly.
- **N+1 detail fetch (Poly Haven only):** Poly Haven's `/assets` list does not contain download URLs. To get a real image preview URL we fan out to `/files/<id>` per asset (same N+1 pattern as `provider-met`'s `/objects/<id>`). ambientCG's `full_json` returns preview URLs inline (no second fetch).

**Tech Stack:** TypeScript (ESM, `"type": "module"`), tsup (build), vitest (test), zod (via core), pnpm workspaces, changesets.

---

## API facts (web-verified 2026-06-29)

**Poly Haven (keyless, all CC0):**
- List: `https://api.polyhaven.com/assets?t=textures` and `?t=hdris` → a **map of `id → asset`**. Each asset: `{ type, name, categories: string[], tags: string[], authors: { [name]: role }, thumbnail_url, max_resolution, ... }`. `type` is `1` for textures, `0` for HDRIs. (`thumbnail_url` example: `https://cdn.polyhaven.com/asset_img/thumbs/aerial_asphalt_01.png?width=256&height=256`.)
- Files: `https://api.polyhaven.com/files/<id>`. For a **texture**, image maps nest as `<MapKey> → <res> → <fmt> → { url, ... }`, e.g. `Diffuse → "1k" → "jpg" → url` = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_asphalt_01/aerial_asphalt_01_diff_1k.jpg`. Non-image keys (`blend`, `gltf`, `mtlx`) also appear — **skip them (D1)**. For an **HDRI**, top-level keys are `tonemapped` (a real `.jpg`), `hdri` (`.hdr`/`.exr` by res), `colorchart`, `backplates`. We use `tonemapped.url` as the image preview and skip `hdri` (HDR/EXR are not standard web images, D1).
- License page (sourceTerms): `https://polyhaven.com/license` — "Our assets are all licensed as CC0…".

**ambientCG (keyless, all CC0):**
- JSON: `https://ambientcg.com/api/v2/full_json?type=Material&include=displayData,imageData&limit=<n>&offset=<o>` (optionally add `&q=<query>`). Response top-level key: **`foundAssets`** (array). Each asset: `{ assetId, displayName, dataType, category, tags, previewImage: { "256-PNG": url, "512-PNG": url, ... }, downloadFolders, ... }`.
- `previewImage` keys are `<size>-<fmt>` strings: `64-PNG, 128-PNG, 256-PNG, 512-PNG, 1024-PNG, 2048-PNG, …-WEBP, …-JPG-FFFFFF, …`. Path to a preview: `foundAssets[0].previewImage["256-PNG"]` = `https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Tiles141.png`. We use the PNG preview (e.g. `512-PNG`, falling back to `256-PNG`) and ignore the zipped 3D/material `downloadFolders` (D1).
- We pass `type=Material` (image-based PBR materials). Non-`Material` dataTypes (e.g. `3DModel`, `Atlas`, `Substance`) must not be emitted (D1) — but since we only ever request `type=Material`, also assert defensively in the mapper.
- License page (sourceTerms): `https://ambientcg.com/license/` — "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License."

---

## Task 1: Decisions & scaffold

- [ ] **1.1: Confirm decisions.** This provider applies:
  - **D1 (modality ceiling):** emit `modality: 'image'` for textures/HDRIs/materials; surface only the image-format preview (`Diffuse → jpg` / `tonemapped.jpg` / `previewImage["*-PNG"]`); **skip 3D model formats** (`blend`/`gltf`/`fbx`/`mtlx`/`usd`/`hdr`/`exr`) for v1. No `3d` modality, no core change.
  - **D2 (whole-source CC0 hardcode):** hardcode `license: 'CC0-1.0'`, `rehostPolicy: 'cache-allowed'`, `rights.raw.sourceTerms = <license page URL>` per source. No per-item license, no `licenseVersion`.

- [ ] **1.2: Execute Shared Task S0** (skeleton) with this substitution row:

  | token | value |
  |---|---|
  | `<id>` | `polyhaven` |
  | `<Fn>` | `polyhaven` |
  | `<Title>` | `Poly Haven` |
  | `<modality>` | `image` |
  | `<auth>` | `keyless` |
  | `<licenseCol>` | `CC0` |

  Notes when running S0:
  - In `package.json` keywords add `"ambientcg"` alongside `"polyhaven"` so the sibling source is discoverable.
  - The README (S0.3) must additionally: (a) state the **3D-model skip (D1)** — only image previews of textures/HDRIs/materials are returned; (b) document the **`ambientcg()` sibling factory** in the same package with a second usage snippet (`import { polyhaven, ambientcg } from '@refkit/provider-polyhaven'`).

---

## Task 2: TDD `polyhaven()` factory — failing test

- [ ] **2.1: Write `packages/provider-polyhaven/src/__tests__/polyhaven.test.ts`** (FAIL first — `polyhaven` not implemented). It routes the list endpoint and the per-id `/files/<id>` endpoint to fixtures, like `provider-met`'s N+1 router.

```ts
import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { polyhaven } from '../index'

// Poly Haven: /assets returns id→asset (no URLs); /files/<id> returns the download tree.
const ctxRouting = (list: unknown, files: Record<string, unknown>): ProviderContext => ({
  fetch: (async (input: string) => {
    const u = String(input)
    if (u.includes('/assets')) return new Response(JSON.stringify(list), { status: 200 })
    const m = u.match(/\/files\/([^/?]+)/)
    if (m && files[m[1]]) return new Response(JSON.stringify(files[m[1]]), { status: 200 })
    return new Response('null', { status: 404 })
  }) as typeof fetch,
})

const LIST = {
  aerial_asphalt_01: {
    type: 1, name: 'Aerial Asphalt 01', categories: ['asphalt', 'road'], tags: ['flat'],
    authors: { 'Rob Tuytel': 'All' },
    thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/aerial_asphalt_01.png?width=256&height=256',
  },
}
const FILES_TEX = {
  aerial_asphalt_01: {
    Diffuse: {
      '1k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_asphalt_01/aerial_asphalt_01_diff_1k.jpg' } },
    },
    // non-image keys that must be ignored:
    blend: { '1k': { blend: { url: 'https://dl.polyhaven.org/x.blend' } } },
    gltf: { '1k': { gltf: { url: 'https://dl.polyhaven.org/x.gltf' } } },
  },
}

describe('polyhaven provider', () => {
  it('maps a texture to a CC0 image reference with a resolved jpg preview', async () => {
    const refs = await polyhaven().search(
      { text: 'asphalt', modalities: ['image'], limit: 5 },
      ctxRouting(LIST, FILES_TEX),
    )
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.title).toBe('Aerial Asphalt 01')
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.author).toBe('Rob Tuytel')
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
    expect(r.rights.raw.sourceTerms).toBe('https://polyhaven.com/license')
    expect(r.preview?.url).toContain('aerial_asphalt_01_diff_1k.jpg')
    expect(r.preview?.mediaType).toBe('image/jpeg')
    expect(r.thumbnail?.url).toContain('thumbs/aerial_asphalt_01.png')
    expect(r.canonicalUrl).toBe('https://polyhaven.com/a/aerial_asphalt_01')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('returns [] when the list is empty', async () => {
    const refs = await polyhaven().search({ text: 'zzz', modalities: ['image'] }, ctxRouting({}, {}))
    expect(refs).toEqual([])
  })
})
```

- [ ] **2.2: Run (expect FAIL).**
  `pnpm --filter @refkit/provider-polyhaven test`
  Expected: FAIL — `polyhaven` is not exported / file has no implementation.

## Task 3: Implement `polyhaven()` — make Task 2 pass

- [ ] **3.1: Write `packages/provider-polyhaven/src/index.ts`** with the `polyhaven()` factory. (`ambientcg()` is added in Task 5.)

```ts
import {
  defineProvider, referenceId,
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
    // rather than hardcoding jpeg (mislabeling a PNG as JPEG).
    preview: { url: imageUrl, mediaType: imageUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg' },
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
```

- [ ] **3.2: Run (expect PASS).**
  `pnpm --filter @refkit/provider-polyhaven test`
  Expected: PASS — both `polyhaven` tests green.

- [ ] **3.3: Typecheck & commit.**
  `pnpm --filter @refkit/provider-polyhaven typecheck`
  Then: `git add -A && git commit -m "feat(provider-polyhaven): polyhaven() CC0 image satellite"`

## Task 4: TDD `ambientcg()` factory — failing test

- [ ] **4.1: Append to `packages/provider-polyhaven/src/__tests__/ambientcg.test.ts`** (new file; FAIL first — `ambientcg` not exported). ambientCG returns preview URLs inline (no N+1).

```ts
import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { ambientcg } from '../index'

const ctxJson = (body: unknown, capture?: (u: string) => void): ProviderContext => ({
  fetch: (async (input: string) => {
    capture?.(String(input))
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch,
})

const FOUND = {
  foundAssets: [
    {
      assetId: 'Tiles141', displayName: 'Tiles 141', dataType: 'Material',
      category: 'Tiles', tags: ['tiles', 'floor'],
      previewImage: {
        '256-PNG': 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Tiles141.png',
        '512-PNG': 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-PNG/Tiles141.png',
      },
    },
  ],
}
const FOUND_NO_IMAGE = {
  foundAssets: [
    // a non-image asset (e.g. plugin/3D-only) with no previewImage → must not be emitted (D1)
    { assetId: 'SomeModel', displayName: 'Some Model', dataType: '3DModel', tags: [] },
  ],
}

describe('ambientcg provider', () => {
  it('maps a Material to a CC0 image reference using the PNG preview', async () => {
    let url = ''
    const refs = await ambientcg().search(
      { text: 'tiles', modalities: ['image'], limit: 5 },
      ctxJson(FOUND, (u) => { url = u }),
    )
    expect(url).toContain('type=Material')
    expect(url).toContain('q=tiles')
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.title).toBe('Tiles 141')
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
    expect(r.rights.raw.sourceTerms).toBe('https://ambientcg.com/license/')
    expect(r.preview?.url).toContain('512-PNG/Tiles141.png')
    expect(r.canonicalUrl).toBe('https://ambientcg.com/view?id=Tiles141')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('drops assets without an image preview (non-image dataType, D1)', async () => {
    const refs = await ambientcg().search({ text: 'x', modalities: ['image'] }, ctxJson(FOUND_NO_IMAGE))
    expect(refs).toEqual([])
  })
})
```

- [ ] **4.2: Run (expect FAIL).**
  `pnpm --filter @refkit/provider-polyhaven test`
  Expected: FAIL on the ambientcg suite (`ambientcg` not exported); polyhaven suite still PASS.

## Task 5: Implement `ambientcg()` — make Task 4 pass

- [ ] **5.1: Append the `ambientcg()` factory to `packages/provider-polyhaven/src/index.ts`.**

```ts
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
```

- [ ] **5.2: Run (expect PASS).**
  `pnpm --filter @refkit/provider-polyhaven test`
  Expected: PASS — all four tests (2 polyhaven + 2 ambientcg) green.

- [ ] **5.3: Typecheck & commit.**
  `pnpm --filter @refkit/provider-polyhaven typecheck`
  Then: `git add -A && git commit -m "feat(provider-polyhaven): ambientcg() sibling CC0 image satellite"`

---

## Final Task: Central wiring — Execute Shared Task S9

Both `polyhaven()` and `ambientcg()` are **keyless**, so both join the base providers array (no env gate). When running S9, apply these source-specific details:

- [ ] **S9.1 (leaf vitest project):** append `'./packages/provider-polyhaven/vitest.config.ts',` to root `vitest.config.ts` `projects`.

- [ ] **S9.2 (README table):** add **one** row to the `@refkit/provider-…` table in root `README.md` (one row per package, matching the pexels precedent — the two factories share the package):
  - `| `@refkit/provider-polyhaven` | Poly Haven + ambientCG | image | keyless | CC0 |`

- [ ] **S9.3 (CLI wiring) in `packages/mcp/src/cli.ts`:**
  - add `import { polyhaven, ambientcg } from '@refkit/provider-polyhaven'`
  - add **both** factories to the keyless base array:
    `openverse(), openverseAudio(), wikimediaCommons(), met(), artic(), gutendex(), poetrydb(), polyhaven(), ambientcg(),`

- [ ] **S9.4 (CLI wiring test) in `packages/mcp/src/__tests__/mcp.test.ts`:** add both ids to the keyless assertion list in `'includes every keyless provider by default'`:
  `for (const id of ['openverse', 'wikimedia-commons', 'met', 'artic', 'gutendex', 'poetrydb', 'polyhaven', 'ambientcg'])`

- [ ] **S9.5 (mcp devDep):** add `"@refkit/provider-polyhaven": "workspace:*"` to `packages/mcp/package.json`.

- [ ] **S9.6 (changeset):** create `.changeset/provider-polyhaven.md`:
```markdown
---
"@refkit/provider-polyhaven": minor
"@refkit/mcp": minor
---

Add @refkit/provider-polyhaven: Poly Haven and ambientCG (sibling factory `ambientcg`) as CC0-normalized image references (textures/HDRIs/materials; 3D model formats skipped for v1).
```

- [ ] **S9.7 (verify repo green):** `pnpm install && pnpm -r typecheck && pnpm test:run` — typecheck clean; all vitest projects (including `provider-polyhaven`) pass.

- [ ] **S9.8 (commit):** `git add -A && git commit -m "feat(provider-polyhaven): Poly Haven + ambientCG satellite (P1)"`

---

## Self-Review

1. **Decisions:** D1 (image-only, skip 3D) + D2 (whole-source CC0 hardcode) stated in Task 1 and enforced in both mappers.
2. **Two factories, one package:** `polyhaven()` + `ambientcg()` exported from one `src/index.ts`, both keyless, both wired to the base array (mirrors pexels+pexelsVideo).
3. **Reference validity:** both emit required `id, modality, source{providerId,sourceUrl}, canonicalUrl, rights, verifiedAt, relevance`; `rights` has `license:'CC0-1.0'`, `rehostPolicy:'cache-allowed'`, `raw{sourceTerms,sourceUrl}`; no `licenseVersion` (correct — not CC-BY/CC-BY-SA).
4. **CC0 round-trip tested:** each suite asserts `rights.license==='CC0-1.0'`, `rights.raw.sourceTerms` is the license page, and `evaluateUse(r.rights,'commercial-product').decision==='allowed'`.
5. **Non-image skip tested:** polyhaven ignores `blend`/`gltf` keys; ambientcg drops non-`Material`/no-preview assets.
