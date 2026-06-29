# Rijksmuseum Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is a leaf of `2026-06-29-p1-providers-index.md` — read that index first; it owns the shared skeleton (Task **S0**), central wiring (Task **S9**), and cross-cutting decisions **D1–D8**. Do **not** repeat their boilerplate here; reference them.

**Goal:** Add `@refkit/provider-rijksmuseum` — a thin, **keyless** satellite that searches the Rijksmuseum collection via the modern **Linked-Art** data services and returns license-normalized `Reference`s. Works carrying a CC0 / Public-Domain-Mark rights URI are surfaced as `CC0-1.0` / `PD`; items without a parseable open-rights URI map to `unknown` (→ `needs-review`).

**Architecture:** One factory `rijksmuseum(config)` returning `defineProvider({ id: 'rijksmuseum', modalities: ['image'], queryFeatures: ['keyword'], capabilities, search })`. The modern Search API returns only Linked-Open-Data **IDs**, so this is an **N+1 provider mirroring `provider-met`**: `search` fetches the search list, then `Promise.all`-fans-out a per-item Linked-Art record fetch for each id (each wrapped in try/catch so one bad fetch never drops the batch), capped via `Math.min(config.maxObjects ?? q.limit ?? 12, 30)`. Each record's per-item rights URI is mapped to a `LicenseId` (D7-style URL match). Permissions are never stored — they derive from `license` via core's `factsFor()`/`evaluateUse()`.

**Tech Stack:** TypeScript (ESM), tsup, vitest, zod (via `@refkit/core`), pnpm workspaces, changesets.

### Modern API shape (verified 2026-06-29 — see Open Questions for residual field-path uncertainty)

Decision (made by coordinator): target the **modern keyless Linked-Art API at `data.rijksmuseum.nl`**, not the deprecated classic Collection API.

- **Search endpoint:** `https://data.rijksmuseum.nl/search/collection` — **keyless** ("No API key is needed"). Params are partial keyword matches: `title`, `creator`, `type`, `material`, `technique`, `description`, `imageAvailable`, `objectNumber`. Paging: each page caps at 100; the next page is the URL in the `next.id` field (server appends a `pageToken`). There is no single global `q=` — this plan uses `title` as the primary keyword param and forwards the others as documented options (flagged in Open Questions).
- **Search response (Linked-Art / ActivityStreams):**
  ```json
  {
    "@context": "https://linked.art/ns/v1/search.json",
    "type": "OrderedCollectionPage",
    "partOf": { "type": "OrderedCollection", "totalItems": 1234, "first": {"id":"…"}, "last": {"id":"…"} },
    "orderedItems": [
      { "id": "https://id.rijksmuseum.nl/200100988", "type": "HumanMadeObject" }
    ],
    "next": { "id": "https://data.rijksmuseum.nl/search/collection?title=…&pageToken=…", "type": "OrderedCollectionPage" }
  }
  ```
  `orderedItems[]` carries **IDs only** — no title/image/rights — hence the N+1 fan-out.
- **Per-item record:** the `id` URL (`https://id.rijksmuseum.nl/{n}`) **303-redirects** to `https://data.rijksmuseum.nl/{n}`; request the Linked-Art JSON-LD with the content-negotiation query arg **`?_profile=la`**. Verified field anchors on a live record (`200100988`, "Misty Sea", Jan Toorop):
  - `type`: `"HumanMadeObject"`
  - **title:** an `identified_by[]` entry of type `"Name"` with a `"content"` string.
  - **creator:** `produced_by` → (`part[].`)`carried_out_by[]` → actor with a `_label` / name.
  - **rights URI (the key signal):** a `subject_to[]` / `subject_of[].subject_to[]` `Right` whose `classified_as[].id` is a creativecommons URI — verified value `https://creativecommons.org/publicdomain/zero/1.0/`.
  - **image URL:** `subject_of[].digitally_carried_by[].access_point[].id`. A record can hold several `DigitalObject`s and **not all `access_point`s are images** — on the live record one resolved to a viewer/collection *page*, not a raw image. The reliable signal is the `DigitalObject`'s own `format` (a MIME type, e.g. `image/jpeg`) and/or an IIIF `conforms_to`. So `findImage()` (Task 3) selects an image-typed/IIIF DigitalObject first, then falls back to a URL heuristic, and **drops the item if neither yields an image** — it never puts a web page in `preview.url`.

  Because the Linked-Art graph is deeply nested and varies per record, the provider extracts these with **defensive recursive walks** (find first creativecommons/rightsstatements URI anywhere; find first image-like `access_point` URL), not brittle fixed index paths. See Open Questions.

**Auth:** **keyless.** No API key, no env var. (The `RijksmuseumConfig.apiKey` from the prior draft is removed.)

---

## Task 1: Decisions & scaffold

- [ ] **1.1: Confirm which cross-cutting decisions apply.** Applicable: **D7 — per-item rights URI is present**, so map the record's CC/PD URI → `LicenseId` via the index's D7-style URL match: `creativecommons.org/publicdomain/zero` → `CC0-1.0`; `creativecommons.org/publicdomain/mark` (and `rightsstatements.org/.../NoCopyright`) → `PD`; `creativecommons.org/licenses/by/<v>` → `CC-BY` (capture version) and `…/by-sa/<v>` → `CC-BY-SA` (capture version); anything else / missing → `unknown`. **D2 still applies as the practical reality** — Rijksmuseum open-access works are effectively CC0/PDM, so in practice the mapper resolves to `CC0-1.0`/`PD`; **CC-BY / CC-BY-SA are not expected** from this source (so `licenseVersion` is implemented for correctness but will normally be absent). Items with no parseable open-rights URI are **kept but marked `unknown`** (→ `needs-review`), not silently dropped — matches the conservative strict-deny convention. **D8 also applies** — `access_point`s can be viewer/collection *pages*, so `findImage()` picks an image-typed/IIIF DigitalObject (then a URL heuristic) and drops items with no real image rather than putting a page in `preview.url`. (D2/D4/D5/D6 — D3 dirty-license — are primarily other providers.)

- [ ] **1.2: Execute Shared Task S0 from the index** with this substitution row:

  | token | value |
  |---|---|
  | `<id>` | `rijksmuseum` |
  | `<Fn>` | `rijksmuseum` |
  | `<Title>` | `Rijksmuseum` |
  | `<modality>` | `image` |
  | `<auth>` | `keyless` |
  | `<licenseCol>` | `CC0 / PD` |

  This creates `packages/provider-rijksmuseum/` (`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `LICENSE`, `README.md`) and runs `pnpm install`. Keywords array should include `"rijksmuseum"`, `"art"`, `"museum"`, `"public-domain"`, `"linked-art"`. The README Usage block needs **no config** (`rijksmuseum()`). Do not commit yet — bundle with the first real change in Task 3.

---

## Task 2: Failing tests for `src/index.ts` (TDD red)

REQUIRED SUB-SKILL: superpowers:test-driven-development — write the test first, watch it fail for the right reason, then implement.

- [ ] **2.1: Write `packages/provider-rijksmuseum/src/__tests__/rijksmuseum.test.ts`.**

This is an N+1 provider, so the mock `ctx.fetch` routes like `met.test.ts`: the search endpoint → an `orderedItems` list body; each per-item URL → that item's Linked-Art record. Use **realistic** verified Linked-Art fixtures (CC0 record, a PDM record, and a rights-less record that must become `unknown`).

```ts
import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { rijksmuseum } from '../index'

// Search returns IDs only → N+1 record fetch. Route /search/collection to the
// list body, and each /{id} (with ?_profile=la) to its record body.
const ctxRouting = (
  list: unknown,
  records: Record<string, unknown>,
  capture?: (searchUrl: string) => void,
): ProviderContext => ({
  fetch: (async (input: Parameters<typeof fetch>[0]) => {
    const u = String(input)
    if (u.includes('/search/collection')) {
      capture?.(u)
      return new Response(JSON.stringify(list), { status: 200 })
    }
    const m = u.match(/\/(\d+)(?:\?|$)/)
    if (m && records[m[1]]) return new Response(JSON.stringify(records[m[1]]), { status: 200 })
    return new Response('null', { status: 404 })
  }) as typeof fetch,
})

const LIST = {
  '@context': 'https://linked.art/ns/v1/search.json',
  type: 'OrderedCollectionPage',
  partOf: { type: 'OrderedCollection', totalItems: 3 },
  orderedItems: [
    { id: 'https://id.rijksmuseum.nl/200100988', type: 'HumanMadeObject' },
    { id: 'https://id.rijksmuseum.nl/200100777', type: 'HumanMadeObject' },
    { id: 'https://id.rijksmuseum.nl/200100666', type: 'HumanMadeObject' },
  ],
  next: { id: 'https://data.rijksmuseum.nl/search/collection?title=sea&pageToken=abc', type: 'OrderedCollectionPage' },
}

// CC0 record (verified shape: title=identified_by[].content of type Name; creator
// via produced_by.carried_out_by; rights URI under subject_to.classified_as.id;
// image under digitally_carried_by.access_point.id).
const REC_CC0 = {
  id: 'https://id.rijksmuseum.nl/200100988',
  type: 'HumanMadeObject',
  identified_by: [
    { type: 'Name', classified_as: [{ id: 'http://vocab.getty.edu/aat/300404670', _label: 'preferred terms' }], content: 'Misty Sea' },
  ],
  produced_by: {
    type: 'Production',
    carried_out_by: [{ id: 'https://id.rijksmuseum.nl/person/toorop', type: 'Person', _label: 'Jan Toorop' }],
  },
  subject_to: [
    { type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/zero/1.0/', _label: 'CC0 1.0' }] },
  ],
  subject_of: [
    { type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://lh3.googleusercontent.com/cc0-image=s0', type: 'DigitalObject' }] }] },
  ],
}

// Public Domain Mark record.
const REC_PDM = {
  id: 'https://id.rijksmuseum.nl/200100777',
  type: 'HumanMadeObject',
  identified_by: [{ type: 'Name', content: 'Old Engraving' }],
  produced_by: { type: 'Production', carried_out_by: [{ type: 'Person', _label: 'Anonymous' }] },
  subject_to: [{ type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/mark/1.0/', _label: 'PDM' }] }],
  subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://lh3.googleusercontent.com/pdm-image=s0' }] }] }],
}

// Rights-less record: no creativecommons/rightsstatements URI anywhere → unknown.
const REC_NO_RIGHTS = {
  id: 'https://id.rijksmuseum.nl/200100666',
  type: 'HumanMadeObject',
  identified_by: [{ type: 'Name', content: 'Untitled (rights unclear)' }],
  produced_by: { type: 'Production', carried_out_by: [{ type: 'Person', _label: 'Unknown Maker' }] },
  subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://lh3.googleusercontent.com/mystery=s0' }] }] }],
}

describe('rijksmuseum provider', () => {
  it('maps a CC0 record to a CC0 reference that clears a commercial-product use', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'], limit: 10 },
      ctxRouting(LIST, { '200100988': REC_CC0, '200100777': REC_PDM, '200100666': REC_NO_RIGHTS }),
    )
    const cc0 = refs.find(r => r.title === 'Misty Sea')!
    expect(cc0.modality).toBe('image')
    expect(cc0.rights.license).toBe('CC0-1.0')
    expect(cc0.rights.author).toBe('Jan Toorop')
    expect(cc0.canonicalUrl).toBe('https://id.rijksmuseum.nl/200100988')
    expect(cc0.preview?.url).toContain('googleusercontent')
    expect(cc0.rights.licenseVersion).toBeUndefined() // CC0/PD never set version
    expect(evaluateUse(cc0.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('maps a Public Domain Mark record to PD', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      ctxRouting(LIST, { '200100988': REC_CC0, '200100777': REC_PDM, '200100666': REC_NO_RIGHTS }),
    )
    const pd = refs.find(r => r.title === 'Old Engraving')!
    expect(pd.rights.license).toBe('PD')
    expect(evaluateUse(pd.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('marks a record with no parseable open-rights URI as unknown → needs-review (not dropped)', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      ctxRouting(LIST, { '200100988': REC_CC0, '200100777': REC_PDM, '200100666': REC_NO_RIGHTS }),
    )
    const mystery = refs.find(r => r.title === 'Untitled (rights unclear)')!
    expect(mystery).toBeDefined() // kept, not silently dropped
    expect(mystery.rights.license).toBe('unknown')
    expect(evaluateUse(mystery.rights, 'commercial-product').decision).toBe('needs-review')
  })

  it('returns [] when the search finds nothing', async () => {
    const refs = await rijksmuseum().search(
      { text: 'zzz', modalities: ['image'] },
      ctxRouting({ '@context': 'x', type: 'OrderedCollectionPage', orderedItems: [] }, {}),
    )
    expect(refs).toEqual([])
  })

  it('survives a single failed per-item fetch without dropping the batch', async () => {
    const refs = await rijksmuseum().search(
      { text: 'sea', modalities: ['image'] },
      // 200100777 record omitted → its fetch 404s; the other two must still map.
      ctxRouting(LIST, { '200100988': REC_CC0, '200100666': REC_NO_RIGHTS }),
    )
    expect(refs.map(r => r.title).sort()).toEqual(['Misty Sea', 'Untitled (rights unclear)'])
  })

  it('drops a record whose only access_point is a viewer/collection page (never a non-image preview)', async () => {
    // No `format`/IIIF on the DigitalObject and the access_point is a web page, not an
    // image → findImage() returns undefined → the item is dropped (not surfaced with a
    // webpage in preview.url).
    const REC_PAGE_ONLY = {
      id: 'https://id.rijksmuseum.nl/200100555',
      type: 'HumanMadeObject',
      identified_by: [{ type: 'Name', content: 'Viewer Only' }],
      subject_to: [{ type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/zero/1.0/' }] }],
      subject_of: [{ type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://www.rijksmuseum.nl/en/collection/SK-A-1' }] }] }],
    }
    const ONE = {
      type: 'OrderedCollectionPage',
      orderedItems: [{ id: 'https://id.rijksmuseum.nl/200100555', type: 'HumanMadeObject' }],
    }
    const refs = await rijksmuseum().search(
      { text: 'x', modalities: ['image'] },
      ctxRouting(ONE, { '200100555': REC_PAGE_ONLY }),
    )
    expect(refs).toEqual([])
  })

  it('prefers an image-typed (format/IIIF) DigitalObject over a non-image access_point', async () => {
    // The first access_point is a page; a second DigitalObject is typed image/jpeg →
    // findImage() must pick the typed one and carry its mediaType.
    const REC_TYPED = {
      id: 'https://id.rijksmuseum.nl/200100444',
      type: 'HumanMadeObject',
      identified_by: [{ type: 'Name', content: 'Typed Image' }],
      subject_to: [{ type: 'Right', classified_as: [{ id: 'https://creativecommons.org/publicdomain/zero/1.0/' }] }],
      subject_of: [
        { type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', access_point: [{ id: 'https://www.rijksmuseum.nl/en/collection/SK-A-2' }] }] },
        { type: 'VisualItem', digitally_carried_by: [{ type: 'DigitalObject', format: 'image/jpeg', access_point: [{ id: 'https://iiif.example.org/image/abc/full/full/0/default.jpg' }] }] },
      ],
    }
    const ONE = { type: 'OrderedCollectionPage', orderedItems: [{ id: 'https://id.rijksmuseum.nl/200100444', type: 'HumanMadeObject' }] }
    const refs = await rijksmuseum().search({ text: 'x', modalities: ['image'] }, ctxRouting(ONE, { '200100444': REC_TYPED }))
    expect(refs).toHaveLength(1)
    expect(refs[0].preview?.url).toBe('https://iiif.example.org/image/abc/full/full/0/default.jpg')
    expect(refs[0].preview?.mediaType).toBe('image/jpeg')
  })

  it('forwards the keyword and documented search options + caps the page size to the limit', async () => {
    let searchUrl = ''
    await rijksmuseum().search(
      {
        text: 'vermeer',
        modalities: ['image'],
        limit: 5,
        providerOptions: { type: 'painting', material: 'canvas', technique: 'oil paint', creator: 'Johannes Vermeer', imageAvailable: true },
      },
      ctxRouting({ type: 'OrderedCollectionPage', orderedItems: [] }, {}, (u) => { searchUrl = u }),
    )
    const url = new URL(searchUrl)
    expect(url.origin + url.pathname).toBe('https://data.rijksmuseum.nl/search/collection')
    expect(url.searchParams.get('title')).toBe('vermeer')        // primary keyword param
    expect(url.searchParams.get('type')).toBe('painting')
    expect(url.searchParams.get('material')).toBe('canvas')
    expect(url.searchParams.get('technique')).toBe('oil paint')
    expect(url.searchParams.get('creator')).toBe('Johannes Vermeer')
    expect(url.searchParams.get('imageAvailable')).toBe('true')
    expect(url.searchParams.get('pageSize')).toBe('5')           // limit → page size cap
    // keyless: never a key param
    expect(url.searchParams.get('key')).toBeNull()
  })
})
```

- [ ] **2.2: Run the tests — expect FAIL (module/exports do not exist yet).**

```bash
pnpm --filter @refkit/provider-rijksmuseum test
```
Expected: **FAIL** — `Cannot find module '../index'` / `rijksmuseum is not a function`. Confirms the red state.

---

## Task 3: Implement `src/index.ts` (TDD green) + commit

- [ ] **3.1: Write `packages/provider-rijksmuseum/src/index.ts`.**

Full code — N+1 fan-out mirrors `provider-met`; the per-item rights-URI → `LicenseId` mapping mirrors `provider-flickr`/D7. Keyless (`RijksmuseumConfig` has no `apiKey`):

```ts
import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface RijksmuseumConfig {
  /** Max records fetched per search. Search returns only IDs, so each result
   *  costs one extra Linked-Art fetch — this bounds that N+1 fan-out. Default 12. */
  maxObjects?: number
}

export interface RijksmuseumSearchOptions {
  /** Object type, e.g. 'painting'. */
  type?: string
  /** Material, e.g. 'canvas'. */
  material?: string
  /** Technique, e.g. 'oil paint'. */
  technique?: string
  /** Maker/artist (maps to `creator`). */
  creator?: string
  /** Free-text description match. */
  description?: string
  /** Restrict to objects with an image. */
  imageAvailable?: boolean
}

const SEARCH = 'https://data.rijksmuseum.nl/search/collection'
const RIJKS_TERMS = 'https://www.rijksmuseum.nl/en/data/policy'

// D7-style: map a CC deed URL to our LicenseId (+ CC version). Rijksmuseum open-access is
// effectively CC0/PDM; BY/BY-SA are implemented for correctness but not expected. CC-only —
// Rijksmuseum does not use rightsstatements.org, so this is replaced by core `mapCcDeedUrl`
// (NOT core `mapRightsUrl`) in helper-refactor Task 4. Named `mapRijksRights` to avoid clashing
// with the core `mapRightsUrl` helper, which additionally handles rightsstatements.org.
function mapRijksRights(url: string | undefined): { license: LicenseId; version?: string } {
  if (!url) return { license: 'unknown' }
  if (/creativecommons\.org\/publicdomain\/zero/.test(url)) return { license: 'CC0-1.0' }
  if (/creativecommons\.org\/publicdomain\/mark/.test(url)) return { license: 'PD' }
  if (/rightsstatements\.org\/(?:vocab|page)\/NoCopyright/i.test(url)) return { license: 'PD' }
  const sa = url.match(/creativecommons\.org\/licenses\/by-sa\/(\d\.\d)/)
  if (sa) return { license: 'CC-BY-SA', version: sa[1] }
  const by = url.match(/creativecommons\.org\/licenses\/by\/(\d\.\d)/)
  if (by) return { license: 'CC-BY', version: by[1] }
  return { license: 'unknown' }
}

// The Linked-Art graph is deeply nested and varies per record, so we extract by
// shape, not by fixed index paths (see plan Open Questions).

/** First string anywhere in the record matching a known rights-deed host. */
function findRightsUrl(node: unknown, depth = 0): string | undefined {
  if (depth > 8 || node == null) return undefined
  if (typeof node === 'string') {
    return /creativecommons\.org\/(publicdomain|licenses)|rightsstatements\.org/.test(node) ? node : undefined
  }
  if (Array.isArray(node)) {
    for (const v of node) { const hit = findRightsUrl(v, depth + 1); if (hit) return hit }
    return undefined
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      const hit = findRightsUrl(v, depth + 1); if (hit) return hit
    }
  }
  return undefined
}

// We must not put a NON-image URL (a viewer/collection web page) into preview.url.
// The API carries the answer: a DigitalObject's `format` (a MIME type) and IIIF
// `conforms_to` say which access_point is the image. So: read the type first, then
// fall back to a cheap URL heuristic, then give up (no network probe — `core` never
// fetches bytes, and that would add an extra request per item). See Open Questions #1.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?)(?:$|\?)/i

/** URL-string heuristic only (no network): does this look like an image resource? */
function isLikelyImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url)
    || /iiif/i.test(url)                       // IIIF image endpoint
    || /\/full\/[^/]+\/\d+\/default/i.test(url) // IIIF Image API request URL
    || /googleusercontent\.com/.test(url)       // Rijksmuseum/Met image CDN
}

interface LaDigitalObject {
  type?: string
  format?: string
  conforms_to?: Array<{ id?: string }>
  access_point?: Array<{ id?: string }>
}

/** Collect every node that carries an `access_point` (the DigitalObjects) anywhere. */
function collectDigitalObjects(node: unknown, out: LaDigitalObject[] = [], depth = 0): LaDigitalObject[] {
  if (depth > 8 || node == null) return out
  if (Array.isArray(node)) { for (const v of node) collectDigitalObjects(v, out, depth + 1); return out }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (Array.isArray(o.access_point)) out.push(o as LaDigitalObject)
    for (const v of Object.values(o)) collectDigitalObjects(v, out, depth + 1)
  }
  return out
}

/** Best usable IMAGE url + its mediaType, or undefined.
 *  Tier 1: a DigitalObject explicitly typed `image/*` or IIIF → trust it.
 *  Tier 2: any access_point whose URL heuristically looks like an image.
 *  Otherwise undefined → the item is dropped (an image provider with no image is useless). */
function findImage(rec: Record<string, unknown>): { url: string; mediaType: string } | undefined {
  const objs = collectDigitalObjects(rec)
  // Tier 1 — explicit type from the data.
  for (const o of objs) {
    const fmt = typeof o.format === 'string' ? o.format : undefined
    const isIiif = Array.isArray(o.conforms_to) && o.conforms_to.some(c => typeof c?.id === 'string' && /iiif/i.test(c.id))
    if ((fmt && fmt.startsWith('image/')) || isIiif) {
      const url = o.access_point?.find(a => typeof a?.id === 'string')?.id
      if (url) return { url, mediaType: fmt && fmt.startsWith('image/') ? fmt : 'image/jpeg' }
    }
  }
  // Tier 2 — URL heuristic fallback.
  for (const o of objs) {
    const hit = o.access_point?.find(a => typeof a?.id === 'string' && isLikelyImageUrl(a.id))?.id
    if (hit) return { url: hit, mediaType: 'image/jpeg' }
  }
  return undefined
}

interface LaName { type?: string; content?: string }
function findTitle(rec: Record<string, unknown>): string | undefined {
  const names = rec.identified_by
  if (Array.isArray(names)) {
    for (const n of names as LaName[]) {
      if (n?.type === 'Name' && typeof n.content === 'string' && n.content) return n.content
    }
  }
  return undefined
}

function findCreator(rec: Record<string, unknown>): string | undefined {
  const prod = rec.produced_by as Record<string, unknown> | undefined
  if (!prod) return undefined
  const direct = prod.carried_out_by
  const parts = Array.isArray(prod.part) ? (prod.part as Record<string, unknown>[]) : []
  const actors = [
    ...(Array.isArray(direct) ? (direct as Record<string, unknown>[]) : []),
    ...parts.flatMap(p => (Array.isArray(p.carried_out_by) ? (p.carried_out_by as Record<string, unknown>[]) : [])),
  ]
  for (const a of actors) {
    const label = a._label ?? (a as { notation?: unknown }).notation
    if (typeof label === 'string' && label) return label
  }
  return undefined
}

function toReference(rec: Record<string, unknown>): Reference | null {
  const id = typeof rec.id === 'string' ? rec.id : undefined
  if (!id) return null
  const img = findImage(rec)
  if (!img) return null // no usable IMAGE url (e.g. only a viewer/collection page) → drop
  const { license, version } = mapRijksRights(findRightsUrl(rec))
  const rights: RightsRecord = {
    license,
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
    author: findCreator(rec) || undefined,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: RIJKS_TERMS, sourceUrl: id },
  }
  return {
    id: referenceId('rijksmuseum', id),
    modality: 'image',
    title: findTitle(rec),
    source: { providerId: 'rijksmuseum', sourceUrl: id },
    canonicalUrl: id,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: img.url },
    preview: { url: img.url, mediaType: img.mediaType },
    relevance: 0,
    raw: rec,
  }
}

function setIfString(url: URL, key: string, value: unknown) {
  if (typeof value !== 'string' || !value) return
  url.searchParams.set(key, value)
}
function setIfBoolean(url: URL, key: string, value: unknown) {
  if (typeof value !== 'boolean') return
  url.searchParams.set(key, String(value))
}

interface SearchPage { orderedItems?: Array<{ id?: string }> }

export function rijksmuseum(config: RijksmuseumConfig = {}) {
  return defineProvider({
    id: 'rijksmuseum',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const opts = q.providerOptions as RijksmuseumSearchOptions | undefined
      const n = Math.min(config.maxObjects ?? q.limit ?? 12, 30)
      const searchUrl = new URL(SEARCH)
      // No global free-text param; `title` is a partial keyword match → use it as the keyword.
      if (q.text) searchUrl.searchParams.set('title', q.text)
      setIfString(searchUrl, 'type', opts?.type)
      setIfString(searchUrl, 'material', opts?.material)
      setIfString(searchUrl, 'technique', opts?.technique)
      setIfString(searchUrl, 'creator', opts?.creator)
      setIfString(searchUrl, 'description', opts?.description)
      setIfBoolean(searchUrl, 'imageAvailable', opts?.imageAvailable)
      searchUrl.searchParams.set('pageSize', String(n)) // best-effort cap; server caps at 100

      const res = await ctx.fetch(searchUrl.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`rijksmuseum search failed: ${res.status}`)
      const page = (await res.json()) as SearchPage
      const ids = (page.orderedItems ?? [])
        .map(it => it.id)
        .filter((u): u is string => typeof u === 'string')
        .slice(0, n)
      if (ids.length === 0) return []

      const records = await Promise.all(ids.map(async (idUrl) => {
        try {
          // Content-negotiate the Linked-Art JSON-LD. id.rijksmuseum.nl 303s to
          // data.rijksmuseum.nl; ?_profile=la selects the Linked-Art profile.
          const recUrl = `${idUrl}${idUrl.includes('?') ? '&' : '?'}_profile=la`
          const r = await ctx.fetch(recUrl, { signal: ctx.signal })
          if (!r.ok) return null
          return (await r.json()) as Record<string, unknown>
        } catch {
          return null // one bad record fetch must not drop the whole batch
        }
      }))
      return records
        .map(rec => (rec ? toReference(rec) : null))
        .filter((r): r is Reference => r !== null)
    },
  })
}
```

- [ ] **3.2: Run the tests — expect PASS.**

```bash
pnpm --filter @refkit/provider-rijksmuseum test
```
Expected: **PASS** — all tests green (CC0 → `allowed`; PDM → `PD` → `allowed`; rights-less → `unknown` → `needs-review`, kept; empty result; one-bad-fetch survives; keyword/options/`pageSize` forwarding, no `key`).

> If the URL-routing test mock mis-routes because the per-item regex also matches digits in the search query, tighten the mock router's `match(/\/(\d+)(?:\?|$)/)` — the real provider is unaffected.

- [ ] **3.3: Typecheck the package.**

```bash
pnpm --filter @refkit/provider-rijksmuseum typecheck
```
Expected: **clean**.

- [ ] **3.4: Commit the package.**

```bash
git add packages/provider-rijksmuseum
git commit -m "feat(provider-rijksmuseum): keyless CC0/PD art search satellite (P1)"
```

---

## Task 4: Central wiring

- [ ] **4.1: Execute Shared Task S9 from the index** with these concrete values:
  - `<id>` = `rijksmuseum`, `<Fn>` = `rijksmuseum`, `<Title>` = `Rijksmuseum`, `<modality>` = `image`, `<auth>` = `keyless`, `<licenseCol>` = `CC0 / PD`.
  - **No ENVVAR** — Rijksmuseum is **keyless**.
  - **S9.3 (CLI):** in `packages/mcp/src/cli.ts` add `import { rijksmuseum } from '@refkit/provider-rijksmuseum'`, then add `rijksmuseum()` to the **base keyless `providers` array** (no env gate).
  - **S9.4 (mcp.test.ts):** add `'rijksmuseum'` to the id list asserted by `'includes every keyless provider by default'`. Do **not** add a BYOK gate.
  - Completes S9.1 (root `vitest.config.ts` project), S9.2 (README provider table row `| `@refkit/provider-rijksmuseum` | Rijksmuseum | image | keyless | CC0 / PD |`), S9.5 (`mcp` devDep `"@refkit/provider-rijksmuseum": "workspace:*"`), S9.6 (changeset), S9.7 (full-repo `pnpm install && pnpm -r typecheck && pnpm test:run` green), S9.8 (commit `feat(provider-rijksmuseum): Rijksmuseum satellite (P1)`).

---

## Self-Review

- [ ] Task 1 states applicable decisions: **D7 applies** (per-item rights URI → URL match to `CC0-1.0`/`PD`/`CC-BY`/`CC-BY-SA`; version only for BY/BY-SA, not expected here); **D2 is the practical reality** (effectively CC0/PDM); rights-less items → `unknown` (kept, not dropped).
- [ ] N+1 shape mirrors `provider-met`: search → IDs → `Promise.all` fan-out, per-item try/catch, `Math.min(maxObjects ?? limit ?? 12, 30)` cap.
- [ ] Emits a valid `Reference` (`id, modality, source{providerId,sourceUrl}, canonicalUrl, rights, verifiedAt, relevance`) and `RightsRecord` (`license, rehostPolicy, raw{sourceTerms,sourceUrl}`); `licenseVersion` only ever set for CC-BY/CC-BY-SA.
- [ ] Tests cover: CC0 → `allowed`; PDM → `PD`; rights-less → `unknown`/`needs-review` (kept); empty; one-bad-fetch resilience; keyword + options + `pageSize` forwarding; keyless (no key param).
- [ ] Keyless wiring: `rijksmuseum()` in the CLI base array; `'rijksmuseum'` in the keyless-by-default id list (no env gate).

## Open Questions (for the reviewer)

1. **Exact Linked-Art field paths could not be byte-verified end-to-end.** The endpoint, keyless auth, `orderedItems` ID-list shape, `pageToken`/`next.id` paging, the `?_profile=la` content-negotiation arg, and the *presence + value* of the CC0 rights URI were verified against the live record `200100988`. But the deep nesting (`subject_of[].subject_to[].classified_as[].id` for rights vs. a top-level `subject_to[]`; `subject_of[].digitally_carried_by[].access_point[].id` for the image) **varies per record**, so the provider uses defensive recursive walks (`findRightsUrl`/`findImage`) rather than fixed paths. Reviewer should fetch 3–5 live records with `?_profile=la` and confirm the walks pick the right rights URI and a usable image URL. **Image-URL handling (resolved in this plan):** because the live `200100988` `access_point` resolved to a viewer/collection page (not a raw image), `findImage()` now (a) prefers a `DigitalObject` typed `image/*` or IIIF-conforming, (b) falls back to a URL-string heuristic (`isLikelyImageUrl`: image extension / `iiif` / IIIF request path / known image CDN), and (c) **drops the item when neither yields an image** rather than emitting a page URL as `preview`. Residual check for the reviewer: confirm against live records that real records expose `format`/IIIF (so Tier 1 fires) or image-extension URLs (so Tier 2 fires); if Rijksmuseum only ever serves a IIIF *manifest* (not an Image-API URL), add a manifest→image-API resolution step or widen `isLikelyImageUrl`.
2. **Keyword query param.** The modern Search API has no single global `q=`; params (`title`, `creator`, `type`, …) are individually partial-keyword matches. This plan routes `q.text` into `title`. Confirm `title` is the best general keyword target, or whether a broader field (e.g. `description`, or issuing the term across multiple params) better matches user intent.
3. **`pageSize` parameter name.** Docs confirm 100-per-page caps and `pageToken` paging but did not explicitly name a page-size param; the plan sends `pageSize` best-effort and additionally caps client-side via `slice(0, n)` (authoritative regardless). Reviewer to confirm/adjust the param name (or drop it and rely solely on the client-side slice).
4. **Deprecated classic API fully removed** — resolved per coordinator decision; this plan targets only the modern `data.rijksmuseum.nl` services. No residual classic-vs-modern question.
