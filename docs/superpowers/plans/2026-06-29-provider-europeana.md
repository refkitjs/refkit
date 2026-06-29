# Europeana Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan extends the **shared skeleton** in `2026-06-29-p1-providers-index.md` — read that first; execute **Shared Task S0** before Task 2 and **Shared Task S9** as the final task. Do not re-paste S0/S9 boilerplate here. Write tests first (TDD): each code task is failing-test → run (FAIL) → implement → run (PASS) → commit.

**Goal:** Add `@refkit/provider-europeana` — a thin satellite that searches the **Europeana Search API** and returns license-normalized image `Reference`s. Each item's `edm:rights` controlled-vocabulary URI is mapped to a core `LicenseId` (+ CC version where applicable); permissions are never stored (derived by core's `factsFor()`/`evaluateUse()`).

**Architecture:** One factory `europeana(config: EuropeanaConfig)` returning `defineProvider({ id: 'europeana', modalities: ['image'], queryFeatures, capabilities, search })`. `search` calls the Search API via `ctx.fetch`, maps each `items[]` element through `toReference`. Two traits make Europeana different from the Met/Flickr templates:

- **Hotlinked media (D6):** media bytes (`edmIsShownBy`) are hosted by third-party data providers, NOT by Europeana. Set `rights.rehostPolicy: 'hotlink-required'` (NOT Flickr's `'cache-allowed'`).
- **`preview` must be an image, never a web page:** EDM distinguishes `edmIsShownBy` (the media resource) from `edmIsShownAt` (a landing **page**). `toReference` puts **only `edmIsShownBy`** into `preview` (gated by `ebucoreHasMimeType`/URL heuristic) and **never `edmIsShownAt`**; `thumbnail` comes from `edmPreview` (Europeana's own thumbnail image service). An item with neither a usable image nor a thumbnail is dropped. `mediaType` is read from `ebucoreHasMimeType`, inferred from the URL extension, or defaulted — not hardcoded.
- **Image-only v1 scope (D1):** Europeana returns mixed media (`type` ∈ `IMAGE | SOUND | VIDEO | TEXT | 3D`). v1 maps only `type === 'IMAGE'` → `modality: 'image'`; non-image items are dropped. SOUND/VIDEO/TEXT support is a documented follow-up (would map to `audio`/`video`/`text` modalities). The search request is constrained server-side with `qf=TYPE:IMAGE` and `media=true`, and `toReference` defensively re-checks `type` (a belt-and-suspenders guard against the filter being relaxed).
- **Array-typed fields:** nearly every metadata field is a JSON array (`title`, `dataProvider`, `provider`, `edmPreview`, `edmIsShownBy`, `edmIsShownAt`, `rights`); only `id`, `type`, `guid` are scalars. Use a safe `first()` helper that returns the first element or `undefined`.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), tsup, vitest, zod (via core), pnpm workspaces, changesets. Depends only on `@refkit/core`.

---

## Task 1: Decisions & scaffold

- [ ] **1.1: Confirm the decisions that apply** (from the index's D1–D8):
  - **D1 — Modality ceiling / image-only scope:** v1 maps only `type === 'IMAGE'` → `modality: 'image'`; SOUND/VIDEO/TEXT/3D are dropped and noted as a follow-up in the README.
  - **D5-style — Map a rights-vocab URI to a license family** (the index files europeana's rights mapping under **D6**, "per D5-style URL matching"; D5 proper is jamendo's): `creativecommons.org/...` deeds → CC family; `creativecommons.org/publicdomain/...` → CC0/PD; CC NC/ND → `proprietary`. **rightsstatements.org is mapped faithfully per token** (not blanket-unknown): InC* → `proprietary` (copyrighted, no grant); `NoC-US` → `PD` + `jurisdiction:'US'`; `NoC-NC` → `proprietary` (non-commercial); `NoC-OKLR`/`NoC-CR`/`CNE`/`UND`/`NKC` → `unknown`. CC NC/ND and in-copyright statements are NEVER mapped to a permissive license; a versioned jurisdiction-scoped PD carries its `jurisdiction`.
  - **D6 — Hotlinked media:** `rights.rehostPolicy: 'hotlink-required'`.
  - **D7 — License version from a CC URL:** extract version via `/\/licenses\/by(?:-sa)?\/(\d\.\d)\//`; set `licenseVersion` only for `CC-BY`/`CC-BY-SA`.
  - **D8 — `preview` must be an image, not a page:** source `preview` from `edmIsShownBy` only (gated by `ebucoreHasMimeType`/URL heuristic), never `edmIsShownAt`; `thumbnail` from `edmPreview`; drop items with neither; `mediaType` read/inferred, not hardcoded.

- [ ] **1.2: Execute Shared Task S0** (see `2026-06-29-p1-providers-index.md` → "Shared Task S0 — Provider satellite skeleton") with this substitution row:

  | placeholder | value |
  |---|---|
  | `<id>` | `europeana` |
  | `<Fn>` | `europeana` |
  | `<Title>` | `Europeana` |
  | `<modality>` | `image` |
  | `<auth>` | `API key` |
  | `<licenseCol>` | `per-item CC / PD / rights-statement` |

  In the README (S0.3), under the bullet list, add a one-line scope note: *"v1 returns images only (`type=IMAGE`); audio/video/text records are a planned follow-up. Media is hotlinked from third-party data providers — cache/rehost is not permitted (`rehostPolicy: 'hotlink-required'`)."*

  Do NOT commit at the end of S0 — bundle the package skeleton with the first real change in Task 2.

---

## Task 2: Rights mapper — `mapEuropeanaRights` (TDD)

- [ ] **2.1: Write the failing test** `packages/provider-europeana/src/__tests__/europeana.test.ts`. This first slice tests only the exported pure mapper:

```ts
import { describe, expect, it } from 'vitest'
import { mapEuropeanaRights } from '../index'

describe('mapEuropeanaRights', () => {
  it('maps CC0 and Public Domain Mark to open licenses (no version)', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapEuropeanaRights('http://creativecommons.org/publicdomain/mark/1.0/')).toEqual({ license: 'PD' })
  })

  it('maps CC-BY / CC-BY-SA and captures the version', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapEuropeanaRights('https://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
  })

  it('maps NC / ND variants to proprietary (not an open grant)', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc/4.0/')).toEqual({ license: 'proprietary' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc-sa/4.0/')).toEqual({ license: 'proprietary' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'proprietary' })
  })

  it('maps rightsstatements.org faithfully: InC→proprietary, NoC-US→PD+US, NoC-NC→proprietary', () => {
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-US/1.0/')).toEqual({ license: 'PD', jurisdiction: 'US' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-NC/1.0/')).toEqual({ license: 'proprietary' })
  })

  it('maps opaque/undetermined rightsstatements + empty/unrecognized to unknown', () => {
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-OKLR/1.0/')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/CNE/1.0/')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('http://example.org/some-other-license')).toEqual({ license: 'unknown' })
  })
})
```

- [ ] **2.2: Run (expect FAIL — `mapEuropeanaRights` not exported yet)**

```bash
pnpm --filter @refkit/provider-europeana test
```

Expected: FAIL (import/resolve error or assertion failures).

- [ ] **2.3: Implement the mapper** in `packages/provider-europeana/src/index.ts`. Order matters: check `publicdomain/zero` and `publicdomain/mark` first, then NC/ND (→ proprietary) before plain BY/BY-SA, because `by-nc-sa` contains the substring `by-sa`.

```ts
import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

const BASE = 'https://api.europeana.eu/record/v2/search.json'

/** Map a Europeana `edm:rights` controlled-vocabulary URI to a core license id (+ CC version,
 *  + jurisdiction for jurisdiction-scoped PD). Conservative (D5): only clearly-open CC deeds and
 *  PD/CC0 become open grants; CC NC/ND → proprietary; rightsstatements.org is mapped faithfully
 *  per token (see below); anything unrecognized/empty → unknown. */
// rightsstatements.org is a rights-STATUS vocabulary (not license grants). Map each token
// FAITHFULLY (index D5-style): InC* → proprietary (copyrighted, no grant); NoC-US → PD scoped
// to the US via the jurisdiction field; NoC-NC → proprietary (non-commercial → commercial out);
// opaque/undetermined (NoC-OKLR/CR, CNE, UND, NKC) → unknown. (This mirrors core `mapRightsUrl`;
// the helper-refactor Task 4 replaces this inlined copy with that import.)
const RIGHTS_STATEMENT: Record<string, { license: LicenseId; jurisdiction?: string }> = {
  'inc': { license: 'proprietary' }, 'inc-ow-eu': { license: 'proprietary' }, 'inc-edu': { license: 'proprietary' },
  'inc-nc': { license: 'proprietary' }, 'inc-ruu': { license: 'proprietary' },
  'noc-us': { license: 'PD', jurisdiction: 'US' },
  'noc-nc': { license: 'proprietary' },
  'noc-oklr': { license: 'unknown' }, 'noc-cr': { license: 'unknown' },
  'cne': { license: 'unknown' }, 'und': { license: 'unknown' }, 'nkc': { license: 'unknown' },
}

export function mapEuropeanaRights(uri: string): { license: LicenseId; version?: string; jurisdiction?: string } {
  const u = (uri || '').toLowerCase()
  if (!u) return { license: 'unknown' }
  // rightsstatements.org — faithful per-token mapping (not blanket unknown).
  const rs = u.match(/rightsstatements\.org\/(?:vocab|page)\/([a-z-]+)/)
  if (rs) return RIGHTS_STATEMENT[rs[1]] ?? { license: 'unknown' }
  // Public domain dedications / marks (no version surfaced).
  if (u.includes('creativecommons.org/publicdomain/zero')) return { license: 'CC0-1.0' }
  if (u.includes('creativecommons.org/publicdomain/mark')) return { license: 'PD' }
  // Non-commercial / no-derivatives variants are NOT open grants → proprietary.
  // Checked before plain by/by-sa because "by-nc-sa" contains "by-sa".
  if (/creativecommons\.org\/licenses\/by-(?:nc|nd)/.test(u)) return { license: 'proprietary' }
  // Open CC deeds: capture the version (D7) for the attribution families only.
  const bySa = u.match(/creativecommons\.org\/licenses\/by-sa\/(\d\.\d)/)
  if (bySa) return { license: 'CC-BY-SA', version: bySa[1] }
  const by = u.match(/creativecommons\.org\/licenses\/by\/(\d\.\d)/)
  if (by) return { license: 'CC-BY', version: by[1] }
  return { license: 'unknown' }
}
```

- [ ] **2.4: Run (expect PASS)**

```bash
pnpm --filter @refkit/provider-europeana test
```

Expected: PASS (the `mapEuropeanaRights` describe block).

- [ ] **2.5: Commit**

```bash
git add -A && git commit -m "feat(provider-europeana): scaffold + edm:rights mapper"
```

---

## Task 3: `toReference` mapper (TDD)

- [ ] **3.1: Add failing tests** to `europeana.test.ts`. These exercise the full item → `Reference` mapping with realistic, **array-typed** fixtures and assert downstream `evaluateUse` verdicts + the hotlink rehost policy. Append:

```ts
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { europeana } from '../index'

// Realistic Europeana Search API item shapes. Note every metadata field is an
// array; id/type/guid are scalars. id is "/datasetId/recordId" with a leading slash.
const ITEM_CC0 = {
  id: '/2048128/europeana_fashion_12345',
  type: 'IMAGE',
  title: ['A Painted Fan'],
  dataProvider: ['Rijksmuseum'],
  provider: ['Europeana Fashion'],
  edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/cc0thumb.jpg'],
  edmIsShownBy: ['https://images.example.org/cc0-full.jpg'],
  edmIsShownAt: ['https://www.rijksmuseum.nl/item/cc0'],
  rights: ['http://creativecommons.org/publicdomain/zero/1.0/'],
}
const ITEM_BY_SA = {
  id: '/9876543/abc_xyz',
  type: 'IMAGE',
  title: ['A Photographed Statue'],
  dataProvider: ['Some Museum'],
  provider: ['Some Aggregator'],
  edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/bysathumb.jpg'],
  edmIsShownBy: ['https://images.example.org/bysa-full.jpg'],
  edmIsShownAt: ['https://museum.example.org/item/bysa'],
  rights: ['https://creativecommons.org/licenses/by-sa/3.0/'],
}
const ITEM_INC = {
  id: '/111/in_copyright',
  type: 'IMAGE',
  title: ['A Modern Photo'],
  dataProvider: ['Living Archive'],
  provider: ['Aggregator'],
  edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/incthumb.jpg'],
  edmIsShownBy: ['https://images.example.org/inc-full.jpg'],
  edmIsShownAt: ['https://archive.example.org/item/inc'],
  rights: ['http://rightsstatements.org/vocab/InC/1.0/'],
}

const okCtx = (items: unknown[]): ProviderContext => ({
  fetch: (async () =>
    new Response(JSON.stringify({ success: true, itemsCount: items.length, totalResults: items.length, items }), { status: 200 })
  ) as typeof fetch,
})

describe('europeana toReference', () => {
  it('maps a CC0 image to an allowed reference with hotlink rehost policy', async () => {
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'fan', modalities: ['image'], limit: 5 }, okCtx([ITEM_CC0]))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.title).toBe('A Painted Fan')
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.rehostPolicy).toBe('hotlink-required')
    expect(r.canonicalUrl).toBe('https://www.europeana.eu/item/2048128/europeana_fashion_12345')
    expect(r.preview?.url).toBe('https://images.example.org/cc0-full.jpg') // from edmIsShownBy
    expect(r.thumbnail?.url).toBe('https://api.europeana.eu/thumbnail/v3/200/cc0thumb.jpg') // from edmPreview
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('preserves the CC-BY-SA version and gates to allowed-with-attribution', async () => {
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'statue', modalities: ['image'] }, okCtx([ITEM_BY_SA]))
    const r = refs[0]
    expect(r.rights.license).toBe('CC-BY-SA')
    expect(r.rights.licenseVersion).toBe('3.0')
    expect(r.rights.rehostPolicy).toBe('hotlink-required')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('maps an in-copyright (InC) rights statement to proprietary → denied', async () => {
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'photo', modalities: ['image'] }, okCtx([ITEM_INC]))
    const r = refs[0]
    expect(r.rights.license).toBe('proprietary')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('denied')
  })

  it('maps NoC-US to PD scoped to the US (allowed by default; jurisdiction-aware callers gate)', async () => {
    const nocUs = { ...ITEM_CC0, id: '/x/noc_us', rights: ['http://rightsstatements.org/vocab/NoC-US/1.0/'] }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([nocUs]))
    const r = refs[0]
    expect(r.rights.license).toBe('PD')
    expect(r.rights.jurisdiction).toBe('US')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
    // a caller whose jurisdiction differs from the source's is deferred to review:
    expect(evaluateUse(r.rights, 'commercial-product', { userJurisdiction: 'DE' }).decision).toBe('needs-review')
  })

  it('drops non-IMAGE items and items with no usable media at all', async () => {
    const sound = { ...ITEM_CC0, id: '/x/sound', type: 'SOUND' }
    const noMedia = { ...ITEM_CC0, id: '/x/nomedia', edmIsShownBy: [], edmIsShownAt: [], edmPreview: [] }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([sound, noMedia, ITEM_CC0]))
    expect(refs).toHaveLength(1)
    expect(refs[0].canonicalUrl).toBe('https://www.europeana.eu/item/2048128/europeana_fashion_12345')
  })

  it('never uses edmIsShownAt (a landing page) as preview; keeps the item via its thumbnail', async () => {
    // No media resource, only a landing PAGE + a Europeana thumbnail image.
    const pageOnly = {
      ...ITEM_CC0,
      id: '/x/page_only',
      edmIsShownBy: [],
      edmIsShownAt: ['https://www.rijksmuseum.nl/en/collection/SK-A-1'], // a web page, NOT an image
      edmPreview: ['https://api.europeana.eu/thumbnail/v3/200/pagethumb.jpg'],
    }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([pageOnly]))
    expect(refs).toHaveLength(1)
    expect(refs[0].preview).toBeUndefined() // the landing page is never surfaced as media
    expect(refs[0].thumbnail?.url).toBe('https://api.europeana.eu/thumbnail/v3/200/pagethumb.jpg')
  })

  it('reads ebucoreHasMimeType for the preview media type when the URL has no extension', async () => {
    const png = {
      ...ITEM_CC0,
      id: '/x/png',
      edmIsShownBy: ['https://images.example.org/no-extension'],
      ebucoreHasMimeType: ['image/png'],
    }
    const refs = await europeana({ apiKey: 'k' }).search({ text: 'x', modalities: ['image'] }, okCtx([png]))
    expect(refs[0].preview?.url).toBe('https://images.example.org/no-extension')
    expect(refs[0].preview?.mediaType).toBe('image/png')
  })
})
```

- [ ] **3.2: Run (expect FAIL — `europeana` factory / `toReference` not implemented)**

```bash
pnpm --filter @refkit/provider-europeana test
```

Expected: FAIL.

- [ ] **3.3: Implement `EuropeanaConfig`, the `first()` helper, and `toReference`** in `src/index.ts` (append after the mapper):

```ts
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

/** First element of an array-typed Europeana field, or undefined. */
function first<T>(arr: T[] | undefined): T | undefined {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined
}

// edmIsShownBy is the MEDIA resource; edmIsShownAt is a LANDING PAGE (a web page, not
// an image) — it must never become preview.url. The record usually tells us the media
// type (ebucoreHasMimeType); otherwise fall back to a URL-string heuristic (no network —
// `core` never fetches bytes, and a probe would add a request per item).
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?)(?:$|\?)/i

/** URL-string heuristic only (no network): does this look like an image resource? */
function isLikelyImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url) || /iiif/i.test(url) || /\/thumbnail\//i.test(url)
}

/** Best image mediaType: the declared MIME if it's an image, else inferred from the
 *  URL extension, else a safe default. */
function imageMediaType(mime: string | undefined, url: string): string {
  if (mime && mime.startsWith('image/')) return mime
  const m = url.match(IMAGE_EXT)
  if (m) { const e = m[1].toLowerCase(); return e === 'jpg' ? 'image/jpeg' : `image/${e === 'tif' ? 'tiff' : e}` }
  return 'image/jpeg'
}

function toReference(it: EuropeanaItem): Reference | null {
  // v1 image-only scope (D1): defensively re-check type even though the search is
  // server-filtered with qf=TYPE:IMAGE.
  if (it.type && it.type !== 'IMAGE') return null
  if (!it.id) return null

  // id is "/datasetId/recordId" (leading slash) → canonical Europeana item page.
  const canonicalUrl = `https://www.europeana.eu/item${it.id}`

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
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
    // jurisdiction-scoped PD (e.g. NoC-US → PD in the US); metadata for evaluateUse.
    ...(jurisdiction ? { jurisdiction } : {}),
    author: first(it.dataProvider) ?? first(it.provider) ?? undefined,
    // D6: media is hotlinked from data providers — caching/rehosting not permitted.
    rehostPolicy: 'hotlink-required',
    raw: { sourceTerms: rightsUri || 'https://www.europeana.eu/rights', sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('europeana', canonicalUrl),
    modality: 'image',
    title: first(it.title) || undefined,
    source: { providerId: 'europeana', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    ...(thumbUrl ? { thumbnail: { url: thumbUrl } } : {}),
    ...(previewUrl ? { preview: { url: previewUrl, mediaType: imageMediaType(mime, previewUrl) } } : {}),
    relevance: 0,
    raw: it,
  }
}
```

- [ ] **3.4: Run (expect PASS for the mapper + the `toReference` blocks; `europeana()` exists now)**

```bash
pnpm --filter @refkit/provider-europeana test
```

Expected: PASS for Tasks 2 & 3 tests. (The `search` factory must already be present for the import to resolve — implement Task 4's `search` in the same pass if needed, or stub-then-fill in Task 4.)

- [ ] **3.5: Commit**

```bash
git add -A && git commit -m "feat(provider-europeana): toReference mapper (image-only, hotlink rehost)"
```

---

## Task 4: `search` + provider factory (TDD)

- [ ] **4.1: Add a failing search-param-forwarding test** to `europeana.test.ts`:

```ts
describe('europeana search request', () => {
  it('sets wskey, query, rows, and the image/media filters', async () => {
    let url = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        url = String(input)
        return new Response(JSON.stringify({ success: true, items: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await europeana({ apiKey: 'my-key' }).search({ text: 'tulips', modalities: ['image'], limit: 7 }, ctx)
    const u = new URL(url)
    expect(u.searchParams.get('wskey')).toBe('my-key')
    expect(u.searchParams.get('query')).toBe('tulips')
    expect(u.searchParams.get('rows')).toBe('7')
    expect(u.searchParams.get('media')).toBe('true')
    expect(u.searchParams.get('qf')).toBe('TYPE:IMAGE')
  })

  it('returns [] when the API yields no items', async () => {
    const ctx: ProviderContext = {
      fetch: (async () => new Response(JSON.stringify({ success: true, items: [] }), { status: 200 })) as typeof fetch,
    }
    expect(await europeana({ apiKey: 'k' }).search({ text: 'zzz', modalities: ['image'] }, ctx)).toEqual([])
  })

  it('throws on a non-ok HTTP status', async () => {
    const ctx: ProviderContext = {
      fetch: (async () => new Response('forbidden', { status: 401 })) as typeof fetch,
    }
    await expect(europeana({ apiKey: 'bad' }).search({ text: 'x', modalities: ['image'] }, ctx)).rejects.toThrow(/europeana search failed: 401/)
  })
})
```

- [ ] **4.2: Run (expect FAIL — `search` not yet wired / asserts unmet)**

```bash
pnpm --filter @refkit/provider-europeana test
```

Expected: FAIL.

- [ ] **4.3: Implement the `europeana` factory + `search`** in `src/index.ts` (append):

```ts
export function europeana(config: EuropeanaConfig) {
  return defineProvider({
    id: 'europeana',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL(BASE)
      url.searchParams.set('wskey', config.apiKey)
      url.searchParams.set('query', q.text)
      url.searchParams.set('rows', String(q.limit ?? 20))
      url.searchParams.set('media', 'true')   // only items that actually carry media
      url.searchParams.set('qf', 'TYPE:IMAGE') // v1 image-only scope (D1)
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`europeana search failed: ${res.status}`)
      const json = (await res.json()) as EuropeanaResponse
      if (!json.items || json.items.length === 0) return []
      return json.items
        .map(toReference)
        .filter((r): r is Reference => r !== null)
    },
  })
}
```

- [ ] **4.4: Run (expect PASS — all describe blocks)**

```bash
pnpm --filter @refkit/provider-europeana test
```

Expected: PASS (mapper + toReference + search). Also typecheck the package:

```bash
pnpm --filter @refkit/provider-europeana typecheck
```

Expected: clean.

- [ ] **4.5: Commit**

```bash
git add -A && git commit -m "feat(provider-europeana): search + factory wiring"
```

---

## Final Task: Central wiring

- [ ] **F.1: Execute Shared Task S9** (see `2026-06-29-p1-providers-index.md` → "Shared Task S9 — Central wiring") with these substitutions:

  | placeholder | value |
  |---|---|
  | `<id>` | `europeana` |
  | `<Fn>` | `europeana` |
  | `<Title>` | `Europeana` |
  | `<modality>` | `image` |
  | `<auth>` | `API key` |
  | `<licenseCol>` | `per-item CC / PD / rights-statement` |
  | `<ENVVAR>` | `EUROPEANA_KEY` |

  Europeana is **BYOK** (not keyless). Concretely:

  - **S9.3 (`packages/mcp/src/cli.ts`):** add `import { europeana } from '@refkit/provider-europeana'`, and after the existing BYOK block add:
    ```ts
    if (env.EUROPEANA_KEY) providers.push(europeana({ apiKey: env.EUROPEANA_KEY }))
    ```
  - **S9.4 (`packages/mcp/src/__tests__/mcp.test.ts`, `describe('defaultProviders'…)`):** mirror the unsplash BYOK gate:
    ```ts
    it('adds europeana only when EUROPEANA_KEY is present', () => {
      expect(defaultProviders({}).map(p => p.id)).not.toContain('europeana')
      expect(defaultProviders({ EUROPEANA_KEY: 'k' }).map(p => p.id)).toContain('europeana')
    })
    ```
  - **S9.5:** add `"@refkit/provider-europeana": "workspace:*"` to `packages/mcp/package.json`.
  - **S9.1 / S9.2 / S9.6 / S9.7 / S9.8:** vitest project list, root README table row, changeset, full-repo green check, final commit — per S9.

- [ ] **F.2: Final verification** (S9.7)

```bash
pnpm install && pnpm -r typecheck && pnpm test:run
```

Expected: typecheck clean; every vitest project (including `provider-europeana`) passes.

---

## Self-Review

1. **Decisions applied:** D1 (image-only v1), D5-style (rights-vocab URI → family), D6 (hotlink rehost + the rights-mapping the index files under D6), D7 (CC version from URL), D8 (preview from edmIsShownBy only, never edmIsShownAt) — all confirmed in Task 1.1.
2. **Reference validity:** every emitted `Reference` has `id, modality, source{providerId,sourceUrl}, canonicalUrl, rights, verifiedAt, relevance`; every `RightsRecord` has `license, rehostPolicy: 'hotlink-required', raw{sourceTerms,sourceUrl}`; `licenseVersion` only for CC-BY/CC-BY-SA.
3. **Faithful, conservative mapping:** CC NC/ND → `proprietary`; rightsstatements InC* → `proprietary`, NoC-US → `PD`+`jurisdiction:'US'`, NoC-NC → `proprietary`, opaque/undetermined (NoC-OKLR/CR, CNE, UND, NKC) + empty/unrecognized → `unknown` (→ `needs-review`). No fabricated open license; no permissive mapping of a restricted/in-copyright statement.
4. **Array safety:** every metadata field read through `first()`; `id`/`type` read as scalars.
5. **Follow-up flagged:** SOUND/VIDEO/TEXT modalities are out of scope for v1 and noted in the README.
6. **No web page as media:** `preview` is sourced only from `edmIsShownBy` (never the `edmIsShownAt` landing page); `thumbnail` from `edmPreview`; `mediaType` from `ebucoreHasMimeType`/extension; items with no usable image or thumbnail are dropped. Tested by the edmIsShownAt-page and MIME cases.
```
