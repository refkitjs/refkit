# Freesound Provider Implementation Plan

> **For agentic workers:** Implement this plan task-by-task using superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This plan is a satellite under the shared skeleton in [`2026-06-29-p1-providers-index.md`](./2026-06-29-p1-providers-index.md) — read that index first. It defines **Shared Task S0** (package scaffold) and **Shared Task S9** (central wiring); this plan references them with substitution rows rather than repeating the boilerplate. Closest code template: `packages/provider-openverse/src/index.ts` (its `openverseAudio`/`toAudioReference` AUDIO leg) plus `packages/provider-flickr/src/index.ts` (BYOK config + exported license mapper).

**Goal:** Add `@refkit/provider-freesound` — search [Freesound](https://freesound.org) for CC/CC0 sound effects and clips, emitted as license-normalized `audio` `Reference`s. BYOK (Freesound API token).

**Architecture:** A thin satellite depending only on `@refkit/core`. The `freesound(config)` factory returns `defineProvider({ id: 'freesound', modalities: ['audio'], queryFeatures: ['keyword'], capabilities, search })`. `search` hits the Freesound APIv2 text-search endpoint via `ctx.fetch`, requests an explicit `fields=` set, maps each result's source-declared `license` to a `LicenseId` via `mapFreesoundLicense`, and builds an `audio` `Reference` via `toAudioReference` (preview = the hq-mp3 preview URL, `mediaType: 'audio/mpeg'`). Permissions are never stored — they derive from `license` via core's `factsFor()`/`evaluateUse()`.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), tsup (build), vitest (test), zod (via core), pnpm workspaces, changesets.

---

## API reference (web-verified 2026-06-29)

- **Endpoint:** `GET https://freesound.org/apiv2/search/text/?query=<q>&token=<API_KEY>&fields=<csv>`
- **Auth:** token. Two equivalent forms documented — query param `&token=YOUR_API_KEY` **or** header `Authorization: Token YOUR_API_KEY`. We use the **query-token** form for simplicity (matches other BYOK providers' "key in the request" convention). Config holds `apiKey`.
- **Response shape:** `{ count, next, previous, results: FreesoundResult[] }`. Request fields explicitly via `fields=id,name,license,username,previews,url,duration,filesize,tags` (default fields are sparse — `previews` and `license` must be requested).
- **`license` field — handle BOTH forms.** Official docs describe a **plain CC name string** (`"Attribution"`, `"Attribution NonCommercial"`, `"Creative Commons 0"`). In practice Freesound has also returned **CC deed URLs** (e.g. `http://creativecommons.org/licenses/by/4.0/`, `http://creativecommons.org/publicdomain/zero/1.0/`) and other name variants (`"Attribution Noncommercial"` casing, `"Sampling+"`, `"Attribution Sampling+"`). `mapFreesoundLicense` must accept either a deed URL or a name string. **D4** (name string → family `LicenseId`, omit `licenseVersion`) is the primary path; **D7** (extract CC version from a deed URL for CC-BY/CC-BY-SA) applies only when a URL form is seen. Unrecognized → `unknown`.
- **`previews` object keys:** `preview-hq-mp3`, `preview-lq-mp3`, `preview-hq-ogg`, `preview-lq-ogg`. We use `preview-hq-mp3` (`audio/mpeg`).

---

## Task 1: Decisions & scaffold

- [ ] **1.1: Confirm applicable cross-cutting decisions.** This provider applies **D4** (Freesound returns a CC name/short string with no reliable version → map name → family `LicenseId`, **omit `licenseVersion`**; unrecognized name → `unknown`) and, defensively, **D7** (if the `license` value is a CC deed *URL* instead, extract the version via `/\/licenses\/by(?:-sa)?\/(\d\.\d)\//` and set `licenseVersion` for `CC-BY`/`CC-BY-SA` only). Conservative/strict-deny throughout: noncommercial/sampling/unrecognized → `proprietary` or `unknown`, never fabricated as free.

- [ ] **1.2: Execute Shared Task S0** (see index) with this substitution row:

  | placeholder | value |
  |---|---|
  | `<id>` | `freesound` |
  | `<Fn>` | `freesound` |
  | `<Title>` | `Freesound` |
  | `<modality>` | `audio` |
  | `<auth>` | `API key` |
  | `<licenseCol>` | `per-item CC / CC0` |

  This produces `packages/provider-freesound/` with `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `LICENSE`, `README.md`, and a `pnpm install`. Do not commit yet — bundle with Task 2's first green commit.

---

## Task 2: License mapper (`mapFreesoundLicense`) — TDD

- [ ] **2.1: Write the failing test.** Create `packages/provider-freesound/src/__tests__/freesound.test.ts` with a `describe('mapFreesoundLicense')` block. Mirror the exported-mapper test style from `provider-flickr`'s `mapFlickrLicense` tests. Run it — it MUST FAIL (module/symbol does not exist yet).

  ```ts
  import { describe, expect, it } from 'vitest'
  import { mapFreesoundLicense } from '../index'

  describe('mapFreesoundLicense', () => {
    it('maps CC name strings (D4 — no version)', () => {
      expect(mapFreesoundLicense('Attribution')).toEqual({ license: 'CC-BY' })
      expect(mapFreesoundLicense('Attribution NonCommercial')).toEqual({ license: 'proprietary' })
      expect(mapFreesoundLicense('Attribution Noncommercial')).toEqual({ license: 'proprietary' })
      expect(mapFreesoundLicense('Creative Commons 0')).toEqual({ license: 'CC0-1.0' })
      expect(mapFreesoundLicense('Sampling+')).toEqual({ license: 'proprietary' })
      expect(mapFreesoundLicense('Attribution Sampling+')).toEqual({ license: 'proprietary' })
    })

    it('maps CC deed URLs and extracts version for BY/BY-SA (D7)', () => {
      expect(mapFreesoundLicense('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
      expect(mapFreesoundLicense('http://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
      expect(mapFreesoundLicense('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
      expect(mapFreesoundLicense('http://creativecommons.org/licenses/by-nc/3.0/')).toEqual({ license: 'proprietary' })
    })

    it('returns unknown for anything unrecognized', () => {
      expect(mapFreesoundLicense('Weird Custom License')).toEqual({ license: 'unknown' })
      expect(mapFreesoundLicense('')).toEqual({ license: 'unknown' })
    })
  })
  ```

  Run: `pnpm --filter @refkit/provider-freesound test`
  Expected: **FAIL** (`mapFreesoundLicense` is not exported / file `src/index.ts` has no such symbol).

- [ ] **2.2: Implement `mapFreesoundLicense` in `src/index.ts`.** Start the module with the core imports and the mapper. The mapper handles the URL form first (D7), then the name-string form (D4), then falls through to `unknown`.

  ```ts
  import {
    defineProvider, referenceId,
    type Reference, type RightsRecord, type LicenseId,
    type NormalizedQuery, type ProviderContext,
  } from '@refkit/core'

  // Freesound's `license` is usually a CC NAME string ("Attribution", "Creative
  // Commons 0") but has historically also been a CC DEED URL. Handle both.
  // D4: name → family LicenseId, no version. D7: URL → family (+ version for BY/BY-SA).
  // Conservative: noncommercial / sampling / unrecognized → proprietary or unknown.
  const FREESOUND_NAME_LICENSE: Record<string, { license: LicenseId }> = {
    'attribution': { license: 'CC-BY' },
    'attribution noncommercial': { license: 'proprietary' },      // NC → not commercially usable
    'creative commons 0': { license: 'CC0-1.0' },
    'sampling+': { license: 'proprietary' },                       // bespoke CC sampling licence, not a clean free grant
    'attribution sampling+': { license: 'proprietary' },
  }

  /** Map a Freesound `license` value (CC name string OR CC deed URL) to our
   *  license + optional CC version. Unrecognized → `unknown` (strict-deny). */
  export function mapFreesoundLicense(value: string): { license: LicenseId; version?: string } {
    const v = (value ?? '').trim()
    if (!v) return { license: 'unknown' }

    // D7 — deed URL form
    if (/^https?:\/\//i.test(v)) {
      if (/\/publicdomain\/zero\//i.test(v)) return { license: 'CC0-1.0' }
      const m = v.match(/\/licenses\/(by(?:-sa)?|by-nc[a-z-]*|by-nd[a-z-]*)\/(\d\.\d)\//i)
      if (m) {
        const fam = m[1].toLowerCase()
        const version = m[2]
        if (fam === 'by') return { license: 'CC-BY', version }
        if (fam === 'by-sa') return { license: 'CC-BY-SA', version }
        return { license: 'proprietary' } // any NC/ND variant
      }
      return { license: 'unknown' }
    }

    // D4 — name string form (case-insensitive)
    return FREESOUND_NAME_LICENSE[v.toLowerCase()] ?? { license: 'unknown' }
  }
  ```

  Run: `pnpm --filter @refkit/provider-freesound test`
  Expected: **PASS** (the `mapFreesoundLicense` describe block is green).

- [ ] **2.3: Commit.** `git add -A && git commit -m "feat(provider-freesound): scaffold + license mapper"` (this folds in the Task 1 scaffold).

---

## Task 3: `toAudioReference` + `FreesoundConfig` + `search` — TDD

- [ ] **3.1: Write the failing test.** Extend `freesound.test.ts` with a `describe('freesound provider')` block that mocks `ctx.fetch` with a realistic Freesound text-search JSON body (mirror `provider-met`'s `ctxRouting` style and the `evaluateUse` import). The mock must return a `results[]` array with each license case. Run it — MUST FAIL (`freesound` factory not exported yet, `toAudioReference`/`search` not implemented).

  ```ts
  import { evaluateUse, type ProviderContext } from '@refkit/core'
  import { freesound } from '../index'

  const ctxJson = (body: unknown, capture?: (url: string) => void): ProviderContext => ({
    fetch: (async (input: string) => {
      capture?.(String(input))
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch,
  })

  const RESULTS = {
    count: 4, next: null, previous: null,
    results: [
      { id: 1, name: 'Door creak', license: 'Attribution', username: 'alice',
        url: 'https://freesound.org/people/alice/sounds/1/',
        previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/1/1_hq.mp3', 'preview-lq-mp3': 'https://cdn.freesound.org/previews/1/1_lq.mp3' },
        duration: 2.5, filesize: 41000, tags: ['door', 'creak'] },
      { id: 2, name: 'Loop NC', license: 'Attribution NonCommercial', username: 'bob',
        url: 'https://freesound.org/people/bob/sounds/2/',
        previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/2/2_hq.mp3' }, duration: 5, filesize: 80000, tags: [] },
      { id: 3, name: 'Public bell', license: 'Creative Commons 0', username: 'carol',
        url: 'https://freesound.org/people/carol/sounds/3/',
        previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/3/3_hq.mp3' }, duration: 1, filesize: 16000, tags: [] },
      { id: 4, name: 'Mystery', license: 'Weird Custom License', username: 'dave',
        url: 'https://freesound.org/people/dave/sounds/4/',
        previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/4/4_hq.mp3' }, duration: 3, filesize: 48000, tags: [] },
    ],
  }

  describe('freesound provider', () => {
    it('maps each license family to audio references', async () => {
      const refs = await freesound({ apiKey: 'k' }).search({ text: 'door', modalities: ['audio'], limit: 10 }, ctxJson(RESULTS))
      expect(refs).toHaveLength(4)
      const byId = Object.fromEntries(refs.map(r => [r.canonicalUrl, r]))

      const cc = byId['https://freesound.org/people/alice/sounds/1/']
      expect(cc.modality).toBe('audio')
      expect(cc.rights.license).toBe('CC-BY')
      expect(cc.rights.author).toBe('alice')
      expect(cc.preview?.url).toBe('https://cdn.freesound.org/previews/1/1_hq.mp3')
      expect(cc.preview?.mediaType).toBe('audio/mpeg')

      const nc = byId['https://freesound.org/people/bob/sounds/2/']
      expect(nc.rights.license).toBe('proprietary')
      expect(evaluateUse(nc.rights, 'commercial-product').decision).toBe('denied')

      const cc0 = byId['https://freesound.org/people/carol/sounds/3/']
      expect(cc0.rights.license).toBe('CC0-1.0')
      expect(evaluateUse(cc0.rights, 'commercial-product').decision).toBe('allowed')

      const unk = byId['https://freesound.org/people/dave/sounds/4/']
      expect(unk.rights.license).toBe('unknown')
      expect(evaluateUse(unk.rights, 'commercial-product').decision).toBe('needs-review')
    })

    it('forwards query, token, and fields; respects limit', async () => {
      let url = ''
      await freesound({ apiKey: 'secret' }).search(
        { text: 'rain', modalities: ['audio'], limit: 7, providerOptions: { sort: 'rating_desc', filter: 'duration:[1 TO 10]' } },
        ctxJson(RESULTS, u => { url = u }),
      )
      const u = new URL(url)
      expect(u.pathname).toBe('/apiv2/search/text/')
      expect(u.searchParams.get('query')).toBe('rain')
      expect(u.searchParams.get('token')).toBe('secret')
      expect(u.searchParams.get('fields')).toContain('previews')
      expect(u.searchParams.get('fields')).toContain('license')
      expect(u.searchParams.get('page_size')).toBe('7')
      expect(u.searchParams.get('sort')).toBe('rating_desc')
      expect(u.searchParams.get('filter')).toBe('duration:[1 TO 10]')
    })
  })
  ```

  Run: `pnpm --filter @refkit/provider-freesound test`
  Expected: **FAIL** (`freesound` factory undefined; only the mapper block passes).

- [ ] **3.2: Implement `FreesoundConfig`, `FreesoundSearchOptions`, `toAudioReference`, and the `freesound` factory** in `src/index.ts` (append below the mapper). Model `toAudioReference` on openverse's `toAudioReference` (audio modality, preview `{url, mediaType}`, no `visual`). Audio has no thumbnail image — omit `thumbnail` (Freesound has no waveform field in the basic search response).

  ```ts
  export interface FreesoundConfig {
    /** Freesound APIv2 token (https://freesound.org/apiv2/apply). Passed as the
     *  `token` query param. The `Authorization: Token <key>` header is the documented
     *  equivalent if a future need arises. */
    apiKey: string
  }

  export interface FreesoundSearchOptions {
    /** Freesound `sort` (e.g. 'score', 'rating_desc', 'downloads_desc', 'created_desc'). */
    sort?: string
    /** Freesound `filter` query (field-scoped Solr-style filter, e.g. 'duration:[1 TO 10]'). */
    filter?: string
    page?: number
    pageSize?: number
  }

  const BASE = 'https://freesound.org/apiv2/search/text/'
  // Fields must be requested explicitly — default search responses omit previews/license.
  const FIELDS = 'id,name,license,username,previews,url,duration,filesize,tags'

  interface FreesoundResult {
    id: number
    name: string
    license: string
    username?: string
    url: string
    previews?: Record<string, string>
    duration?: number
    filesize?: number
    tags?: string[]
  }
  interface FreesoundResponse { count: number; results: FreesoundResult[] }

  function toAudioReference(r: FreesoundResult): Reference {
    const { license, version } = mapFreesoundLicense(r.license)
    const canonicalUrl = r.url
    const rights: RightsRecord = {
      license,
      // version only ever set when the license arrived as a CC deed URL (D7); D4 omits it.
      licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
      author: r.username || undefined,
      rehostPolicy: 'cache-allowed',
      raw: { sourceTerms: 'https://freesound.org/help/tos_api/', sourceUrl: canonicalUrl },
    }
    const previewUrl = r.previews?.['preview-hq-mp3'] ?? r.previews?.['preview-lq-mp3']
    return {
      id: referenceId('freesound', canonicalUrl),
      modality: 'audio',
      title: r.name || undefined,
      source: { providerId: 'freesound', sourceUrl: canonicalUrl },
      canonicalUrl,
      rights,
      verifiedAt: new Date().toISOString(),
      ...(previewUrl ? { preview: { url: previewUrl, mediaType: 'audio/mpeg' } } : {}),
      relevance: 0, // mergeReferences assigns the final RRF relevance
      raw: r,
    }
  }

  function setIfString(url: URL, key: string, value: unknown) {
    if (typeof value !== 'string' || !value) return
    url.searchParams.set(key, value)
  }

  function setIfPositiveInt(url: URL, key: string, value: unknown) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return
    url.searchParams.set(key, String(value))
  }

  export function freesound(config: FreesoundConfig) {
    return defineProvider({
      id: 'freesound',
      modalities: ['audio'],
      queryFeatures: ['keyword'],
      capabilities: { controls: [] },
      async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
        const opts = q.providerOptions as FreesoundSearchOptions | undefined
        const url = new URL(BASE)
        url.searchParams.set('query', q.text)
        url.searchParams.set('token', config.apiKey)
        url.searchParams.set('fields', FIELDS)
        url.searchParams.set('page_size', String(opts?.pageSize ?? q.limit ?? 20))
        setIfString(url, 'sort', opts?.sort)
        setIfString(url, 'filter', opts?.filter)
        setIfPositiveInt(url, 'page', opts?.page)
        const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
        if (!res.ok) throw new Error(`freesound search failed: ${res.status}`)
        const json = (await res.json()) as FreesoundResponse
        if (!json.results) return []
        return json.results.map(toAudioReference)
      },
    })
  }
  ```

  Run: `pnpm --filter @refkit/provider-freesound test`
  Expected: **PASS** (both describe blocks green).

- [ ] **3.3: Typecheck the package.**
  Run: `pnpm --filter @refkit/provider-freesound typecheck`
  Expected: clean.

- [ ] **3.4: Commit.** `git add -A && git commit -m "feat(provider-freesound): audio search + reference mapper"`

---

## Final Task: Central wiring

- [ ] **F.1: Execute Shared Task S9** (see index) with this substitution row:

  | placeholder | value |
  |---|---|
  | `<id>` | `freesound` |
  | `<Fn>` | `freesound` |
  | `<Title>` | `Freesound` |
  | `<modality>` | `audio` |
  | `<auth>` | `API key` |
  | `<licenseCol>` | `per-item CC / CC0` |
  | `<ENVVAR>` | `FREESOUND_TOKEN` |

  Freesound is **BYOK**, so:
  - **S9.3 (cli.ts):** add `import { freesound } from '@refkit/provider-freesound'` and, in the BYOK block of `defaultProviders` in `packages/mcp/src/cli.ts`, append:
    ```ts
    if (env.FREESOUND_TOKEN) providers.push(freesound({ apiKey: env.FREESOUND_TOKEN }))
    ```
  - **S9.4 (mcp.test.ts):** in `describe('defaultProviders'…)`, add a BYOK-gating assertion mirroring the unsplash one:
    ```ts
    expect(defaultProviders({}).map(p => p.id)).not.toContain('freesound')
    expect(defaultProviders({ FREESOUND_TOKEN: 'k' }).map(p => p.id)).toContain('freesound')
    ```
  - **S9.5:** add `"@refkit/provider-freesound": "workspace:*"` to `packages/mcp/package.json` deps.
  - **S9.1 / S9.2 / S9.6:** root `vitest.config.ts` projects array, root `README.md` provider table row, and `.changeset/provider-freesound.md` per the index template.

- [ ] **F.2: Verify the whole repo green (S9.7).**
  Run: `pnpm install && pnpm -r typecheck && pnpm test:run`
  Expected: typecheck clean; all vitest projects (including `provider-freesound`) pass.

- [ ] **F.3: Commit (S9.8).** `git add -A && git commit -m "feat(provider-freesound): Freesound satellite (P1)"`

---

## Self-Review

1. **Decision coverage:** Task 1.1 states D4 (primary, name string, no version) and D7 (defensive, deed URL → version for BY/BY-SA) apply.
2. **Type consistency:** `toAudioReference` emits a valid `Reference` (`id, modality:'audio', source, canonicalUrl, rights, verifiedAt, relevance`) and a valid `RightsRecord` (`license, rehostPolicy:'cache-allowed', raw{sourceTerms,sourceUrl}`); `licenseVersion` only set for CC-BY/CC-BY-SA (and only when a deed URL supplied one).
3. **Strict-deny intact:** NC/sampling → `proprietary` → `denied` for commercial; unrecognized/empty → `unknown` → `needs-review`. No fabricated free licenses.
4. **API form documented:** query-token auth chosen; header form noted as equivalent. `fields=` requested explicitly so `previews`/`license` are present.
