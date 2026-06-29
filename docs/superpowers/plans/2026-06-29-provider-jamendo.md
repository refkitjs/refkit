# Jamendo Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan depends on the shared skeleton in [`2026-06-29-p1-providers-index.md`](./2026-06-29-p1-providers-index.md) — read it first; **Task 1** and the **Final Task** delegate to Shared Tasks **S0** and **S9** there rather than repeating boilerplate.

**Goal:** Add `@refkit/provider-jamendo` — a BYOK audio (music) satellite that searches the Jamendo API v3.0 `/tracks/` endpoint and returns license-normalized `Reference`s. Each track carries a per-item Creative Commons deed URL (`license_ccurl`); only CC-BY and CC-BY-SA fit refkit's enum, so the mapper applies decisions **D5** (partial enum fit) and **D7** (CC version from URL).

**Architecture:** A thin satellite depending only on `@refkit/core`. `jamendo(config)` returns `defineProvider({ id: 'jamendo', modalities: ['audio'], … , search })`. `search` GETs `https://api.jamendo.com/v3.0/tracks/` with `client_id` (BYOK), `format=json`, `search`, and `limit`, then maps each `results[]` track to a `Reference` via `toAudioReference`. The CC permission family is derived from `license_ccurl` by `mapJamendoLicense`; permissions are never stored — core's `factsFor()`/`evaluateUse()` derive them from `license`. Mirror `provider-openverse`'s `toAudioReference` (modality `'audio'`, preview = the mp3 stream, image → thumbnail).

**Tech Stack:** TypeScript (ESM, `"type": "module"`), tsup (build), vitest (test), zod (via core), pnpm workspaces, changesets.

---

## Task 1: Decisions & scaffold

- [ ] **1.1: Confirm decisions.** This provider applies **D5** (jamendo `license_ccurl` → match the CC URL to a family: `/licenses/by/<v>/` → `CC-BY`, `/licenses/by-sa/<v>/` → `CC-BY-SA`; any `by-nc*`/`by-nd*` variant → `proprietary`; missing/unrecognized → `unknown`) and **D7** (capture the CC version from the deed URL, set `licenseVersion` only for the `CC-BY`/`CC-BY-SA` families). No other decisions apply.

- [ ] **1.2: Execute Shared Task S0** (provider satellite skeleton) with these substitutions:

  | placeholder | value |
  |---|---|
  | `<id>` | `jamendo` |
  | `<Fn>` | `jamendo` |
  | `<Title>` | `Jamendo` |
  | `<modality>` | `audio` |
  | `<auth>` | `API key` |
  | `<licenseCol>` | `per-item CC` |

  This creates `packages/provider-jamendo/` with `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `LICENSE`, `README.md`, and runs `pnpm install`. Do not commit yet — bundle with the first real change in Task 2.

---

## Task 2: TDD `mapJamendoLicense` + `toAudioReference` (CC-BY happy path)

- [ ] **2.1: Write the failing test first.** Create `packages/provider-jamendo/src/__tests__/jamendo.test.ts`. Mock `ctx.fetch` with realistic Jamendo JSON (a `headers`/`results[]` envelope). Start with a single CC-BY 4.0 track.

```ts
import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { jamendo, mapJamendoLicense } from '../index'

// Jamendo wraps results in { headers, results }. This ctx captures the request URL
// (to assert client_id/search/limit forwarding) and returns the supplied body.
const ctxCapturing = (body: unknown): { ctx: ProviderContext; url: () => string } => {
  let captured = ''
  const ctx: ProviderContext = {
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      captured = String(input)
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch,
  }
  return { ctx, url: () => captured }
}

const envelope = (results: unknown[]) => ({
  headers: { status: 'success', code: 0, error_message: '', results_count: results.length },
  results,
})

const TRACK_BY = {
  id: '1848357',
  name: 'Sunrise',
  artist_name: 'fankel',
  audio: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp31&from=app-devsite',
  audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1848357/mp32/',
  image: 'https://usercontent.jamendo.com?type=album&id=368084&width=300&trackid=1848357',
  shareurl: 'https://www.jamendo.com/track/1848357',
  shorturl: 'https://jamen.do/t/1848357',
  license_ccurl: 'http://creativecommons.org/licenses/by/4.0/',
}

describe('mapJamendoLicense', () => {
  it('maps CC-BY and CC-BY-SA with version, NC/ND → proprietary, missing → unknown', () => {
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapJamendoLicense('https://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toEqual({ license: 'proprietary' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nc/2.0/')).toEqual({ license: 'proprietary' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'proprietary' })
    expect(mapJamendoLicense('')).toEqual({ license: 'unknown' })
    expect(mapJamendoLicense('https://example.com/whatever')).toEqual({ license: 'unknown' })
  })
})

describe('jamendo provider', () => {
  it('maps a CC-BY track to a CC-BY audio reference (allowed-with-attribution)', async () => {
    const { ctx } = ctxCapturing(envelope([TRACK_BY]))
    const refs = await jamendo({ clientId: 'cid' }).search({ text: 'sunrise', modalities: ['audio'], limit: 5 }, ctx)
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('audio')
    expect(r.rights.license).toBe('CC-BY')
    expect(r.rights.licenseVersion).toBe('4.0')
    expect(r.rights.author).toBe('fankel')
    expect(r.title).toBe('Sunrise')
    expect(r.canonicalUrl).toBe('https://www.jamendo.com/track/1848357')
    expect(r.preview?.url).toContain('trackid=1848357')
    expect(r.preview?.mediaType).toBe('audio/mpeg')
    expect(r.thumbnail?.url).toContain('usercontent.jamendo.com')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })
})
```

- [ ] **2.2: Run the test — expect FAIL** (module/exports do not exist yet).

```bash
pnpm --filter @refkit/provider-jamendo test
```
Expected: FAIL — `Cannot find module '../index'` / `jamendo`/`mapJamendoLicense` is not exported.

- [ ] **2.3: Implement `src/index.ts` to pass.** Create `packages/provider-jamendo/src/index.ts`:

```ts
import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface JamendoConfig {
  /** Jamendo API client_id (BYOK). Register at https://devportal.jamendo.com/. */
  clientId: string
}

export interface JamendoSearchOptions {
  /** mp3 stream quality. Default 'mp31' (96 kbps). */
  audioformat?: 'mp31' | 'mp32' | 'ogg' | 'flac'
  order?: 'relevance' | 'popularity_total' | 'popularity_month' | 'popularity_week' | 'releasedate_asc' | 'releasedate_desc' | 'buzzrate'
  /** Restrict to tracks whose license permits a given use, server-side. Relevance
   *  hint only — mapJamendoLicense below is the authoritative rights gate. */
  ccsa?: boolean
  ccnd?: boolean
  ccnc?: boolean
  tags?: string | readonly string[]
  artist_name?: string
  offset?: number
}

const BASE = 'https://api.jamendo.com/v3.0/tracks/'

// The `audioformat` request param decides what `t.audio` streams; reflect it in mediaType
// rather than hardcoding audio/mpeg (which would mislabel ogg/flac requests).
const JAMENDO_AUDIO_MIME: Record<string, string> = {
  mp31: 'audio/mpeg', mp32: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac',
}

interface JamendoTrack {
  id: string
  name: string
  artist_name: string
  audio: string
  audiodownload?: string
  image: string
  shareurl: string
  shorturl?: string
  license_ccurl: string
}
interface JamendoResponse {
  headers: { status: string; code: number; error_message?: string; results_count: number }
  results: JamendoTrack[]
}

// Jamendo deed URLs look like http(s)://creativecommons.org/licenses/<variant>/<v>/.
// Only by/by-sa fit our enum (D5); capture the version (D7). Any nc/nd variant is
// non-commercial or no-derivatives → 'proprietary'. Missing/unrecognized → 'unknown'.
export function mapJamendoLicense(ccurl: string): { license: LicenseId; version?: string } {
  if (!ccurl) return { license: 'unknown' }
  const by = ccurl.match(/\/licenses\/by\/(\d\.\d)\//)
  if (by) return { license: 'CC-BY', version: by[1] }
  const bySa = ccurl.match(/\/licenses\/by-sa\/(\d\.\d)\//)
  if (bySa) return { license: 'CC-BY-SA', version: bySa[1] }
  if (/\/licenses\/by-(nc|nd)/.test(ccurl)) return { license: 'proprietary' }
  return { license: 'unknown' }
}

function toAudioReference(t: JamendoTrack, mediaType: string): Reference {
  const { license, version } = mapJamendoLicense(t.license_ccurl)
  const canonicalUrl = t.shareurl
  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), kept for the BY/BY-SA family.
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
    author: t.artist_name || undefined,
    // governed by the per-item CC license; the mp3 stream is served directly by Jamendo
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: t.license_ccurl, sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('jamendo', canonicalUrl),
    modality: 'audio',
    title: t.name || undefined,
    source: { providerId: 'jamendo', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    // audio has no native thumbnail; the album art is the closest visual handle
    ...(t.image ? { thumbnail: { url: t.image } } : {}),
    preview: { url: t.audio, mediaType },
    relevance: 0, // per-source order; mergeReferences assigns the final RRF relevance
    raw: t,
  }
}

function setIfString(url: URL, key: string, value: unknown, allowed?: readonly string[]) {
  if (typeof value !== 'string' || !value) return
  if (allowed && !allowed.includes(value)) return
  url.searchParams.set(key, value)
}

function setIfStringList(url: URL, key: string, value: unknown) {
  if (typeof value === 'string' && value) url.searchParams.set(key, value)
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v)) url.searchParams.set(key, value.join(' '))
}

function setIfBooleanFlag(url: URL, key: string, value: unknown) {
  if (typeof value !== 'boolean') return
  url.searchParams.set(key, value ? 'true' : 'false')
}

function setIfPositiveInt(url: URL, key: string, value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return
  url.searchParams.set(key, String(value))
}

export function jamendo(config: JamendoConfig) {
  return defineProvider({
    id: 'jamendo',
    modalities: ['audio'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL(BASE)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('format', 'json')
      url.searchParams.set('search', q.text)
      url.searchParams.set('limit', String(Math.min(q.limit ?? 20, 200)))
      const opts = q.providerOptions as JamendoSearchOptions | undefined
      setIfString(url, 'audioformat', opts?.audioformat, ['mp31', 'mp32', 'ogg', 'flac'])
      setIfString(url, 'order', opts?.order, ['relevance', 'popularity_total', 'popularity_month', 'popularity_week', 'releasedate_asc', 'releasedate_desc', 'buzzrate'])
      setIfBooleanFlag(url, 'ccsa', opts?.ccsa)
      setIfBooleanFlag(url, 'ccnd', opts?.ccnd)
      setIfBooleanFlag(url, 'ccnc', opts?.ccnc)
      setIfStringList(url, 'tags', opts?.tags)
      setIfString(url, 'artist_name', opts?.artist_name)
      setIfPositiveInt(url, 'offset', opts?.offset)
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`jamendo search failed: ${res.status}`)
      const json = (await res.json()) as JamendoResponse
      if (json.headers?.status !== 'success') throw new Error(`jamendo search error: ${json.headers?.error_message || json.headers?.status}`)
      const mediaType = JAMENDO_AUDIO_MIME[opts?.audioformat ?? 'mp31'] ?? 'audio/mpeg'
      return (json.results ?? []).map((t) => toAudioReference(t, mediaType))
    },
  })
}
```

- [ ] **2.4: Run the test — expect PASS.**

```bash
pnpm --filter @refkit/provider-jamendo test
```
Expected: PASS — both the `mapJamendoLicense` table and the CC-BY reference test green.

- [ ] **2.5: Commit.**

```bash
git add -A
git commit -m "feat(provider-jamendo): scaffold + CC-BY audio mapping (P1)"
```

---

## Task 3: TDD non-commercial track → proprietary → denied

- [ ] **3.1: Add the failing test.** Append to `jamendo.test.ts` a CC-BY-NC track and assert it gates closed for commercial use.

```ts
const TRACK_NC = {
  ...TRACK_BY,
  id: '2000001',
  name: 'For Listening Only',
  license_ccurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
  shareurl: 'https://www.jamendo.com/track/2000001',
}

it('maps a CC-BY-NC-ND track to proprietary → denied for commercial use', async () => {
  const { ctx } = ctxCapturing(envelope([TRACK_NC]))
  const refs = await jamendo({ clientId: 'cid' }).search({ text: 'listen', modalities: ['audio'] }, ctx)
  expect(refs).toHaveLength(1)
  expect(refs[0].rights.license).toBe('proprietary')
  expect(refs[0].rights.licenseVersion).toBeUndefined()
  expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('denied')
})
```

- [ ] **3.2: Run — expect PASS** (already handled by the `by-(nc|nd)` branch in `mapJamendoLicense`; this test locks the behavior in).

```bash
pnpm --filter @refkit/provider-jamendo test
```
Expected: PASS. (Why it's correct: the `CC-BY`/`CC-BY-SA` branches use literal-slash anchors — `/\/licenses\/by\/(\d\.\d)\//` and `/\/licenses\/by-sa\/(\d\.\d)\//` — so a `by-nc*`/`by-nd*` URL can never match them no matter the branch order; the `by-(nc|nd)` test then catches those → `proprietary`. Branch order is irrelevant here. If this FAILs, the bug is in a regex anchor, not the ordering.)

- [ ] **3.3: Commit.**

```bash
git add -A
git commit -m "test(provider-jamendo): NC/ND → proprietary denied for commercial"
```

---

## Task 4: TDD missing/unrecognized ccurl → unknown → needs-review

- [ ] **4.1: Add the failing test.** Append a track with an empty `license_ccurl` and one with a non-CC URL.

```ts
const TRACK_NO_LICENSE = {
  ...TRACK_BY,
  id: '3000002',
  name: 'Mystery Track',
  license_ccurl: '',
  shareurl: 'https://www.jamendo.com/track/3000002',
}

it('maps a track with no recognizable license to unknown → needs-review', async () => {
  const { ctx } = ctxCapturing(envelope([TRACK_NO_LICENSE]))
  const refs = await jamendo({ clientId: 'cid' }).search({ text: 'mystery', modalities: ['audio'] }, ctx)
  expect(refs).toHaveLength(1)
  expect(refs[0].rights.license).toBe('unknown')
  expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('needs-review')
})
```

- [ ] **4.2: Run — expect PASS** (the empty/unrecognized branch already returns `unknown`; core turns `unknown` into `needs-review`).

```bash
pnpm --filter @refkit/provider-jamendo test
```
Expected: PASS.

- [ ] **4.3: Commit.**

```bash
git add -A
git commit -m "test(provider-jamendo): missing/unknown ccurl → needs-review"
```

---

## Task 5: TDD request forwarding (client_id, search, limit, options)

- [ ] **5.1: Add the failing test.** Assert the outgoing request carries the BYOK `client_id`, the `search` text, the `limit`, `format=json`, and forwarded provider options.

```ts
it('forwards client_id, search, limit, format and documented options', async () => {
  const { ctx, url } = ctxCapturing(envelope([]))
  await jamendo({ clientId: 'my-client-id' }).search({
    text: 'ambient',
    modalities: ['audio'],
    limit: 7,
    providerOptions: { audioformat: 'mp32', order: 'popularity_total', ccnc: false, tags: ['ambient', 'chill'], artist_name: 'fankel', offset: 20 },
  }, ctx)
  const u = new URL(url())
  expect(u.searchParams.get('client_id')).toBe('my-client-id')
  expect(u.searchParams.get('format')).toBe('json')
  expect(u.searchParams.get('search')).toBe('ambient')
  expect(u.searchParams.get('limit')).toBe('7')
  expect(u.searchParams.get('audioformat')).toBe('mp32')
  expect(u.searchParams.get('order')).toBe('popularity_total')
  expect(u.searchParams.get('ccnc')).toBe('false')
  expect(u.searchParams.get('tags')).toBe('ambient chill')
  expect(u.searchParams.get('artist_name')).toBe('fankel')
  expect(u.searchParams.get('offset')).toBe('20')
})

it('returns [] when Jamendo finds nothing', async () => {
  const { ctx } = ctxCapturing(envelope([]))
  const refs = await jamendo({ clientId: 'cid' }).search({ text: 'zzzz', modalities: ['audio'] }, ctx)
  expect(refs).toEqual([])
})
```

- [ ] **5.2: Run — expect PASS** (forwarding is implemented in Task 2's `search`; this test pins the contract).

```bash
pnpm --filter @refkit/provider-jamendo test
```
Expected: PASS — all jamendo tests green.

- [ ] **5.3: Typecheck the package.**

```bash
pnpm --filter @refkit/provider-jamendo typecheck
```
Expected: clean (no type errors).

- [ ] **5.4: Commit.**

```bash
git add -A
git commit -m "test(provider-jamendo): request forwarding (client_id/search/limit/options)"
```

---

## Final Task: Central wiring

- [ ] **F.1: Execute Shared Task S9** (central wiring) with these substitutions: `<id>=jamendo`, `<Fn>=jamendo`, `<Title>=Jamendo`, `<modality>=audio`, `<auth>=API key`, `<licenseCol>=per-item CC`, **`<ENVVAR>=JAMENDO_CLIENT_ID`**. This covers S9.1 (root `vitest.config.ts` project), S9.2 (README provider table row), S9.5 (`mcp` devDep), S9.6 (changeset), S9.7 (repo-green verify), S9.8 (commit).

- [ ] **F.2: S9.3 — BYOK gating in `packages/mcp/src/cli.ts`.** Jamendo is BYOK:
  - add `import { jamendo } from '@refkit/provider-jamendo'`
  - after the existing BYOK block, add:
    ```ts
    if (env.JAMENDO_CLIENT_ID) providers.push(jamendo({ clientId: env.JAMENDO_CLIENT_ID }))
    ```

- [ ] **F.3: S9.4 — CLI wiring test in `packages/mcp/src/__tests__/mcp.test.ts`.** In the `describe('defaultProviders'…)` block, add an assertion mirroring the unsplash gate (id absent without env, present with the key):
  ```ts
  it('adds jamendo only when JAMENDO_CLIENT_ID is present', () => {
    expect(defaultProviders({}).map(p => p.id)).not.toContain('jamendo')
    expect(defaultProviders({ JAMENDO_CLIENT_ID: 'k' }).map(p => p.id)).toContain('jamendo')
  })
  ```

- [ ] **F.4: Verify the whole repo green** (S9.7).

```bash
pnpm install && pnpm -r typecheck && pnpm test:run
```
Expected: typecheck clean; all vitest projects (including `provider-jamendo` and the extended `mcp` wiring test) PASS.

- [ ] **F.5: Commit** (S9.8).

```bash
git add -A
git commit -m "feat(provider-jamendo): Jamendo satellite (P1)"
```

---

## Self-Review

1. **Reference validity:** every emitted `Reference` has `id, modality:'audio', source{providerId,sourceUrl}, canonicalUrl, rights, verifiedAt, relevance`; `RightsRecord` has `license, rehostPolicy:'cache-allowed', raw{sourceTerms,sourceUrl}`; `licenseVersion` set only for `CC-BY`/`CC-BY-SA`.
2. **Decision coverage:** D5 (CC URL → family; NC/ND → proprietary; unrecognized → unknown) and D7 (version from CC URL) are both implemented in `mapJamendoLicense` and tested.
3. **Conservative rights:** missing/unrecognized `license_ccurl` → `unknown` → `needs-review`; never fabricated.
4. **BYOK gating:** `jamendo` requires `clientId`; CLI adds it only when `JAMENDO_CLIENT_ID` is set, asserted by the wiring test.
