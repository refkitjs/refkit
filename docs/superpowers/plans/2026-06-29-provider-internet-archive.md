# Internet Archive Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-06-29-p1-providers-index.md` FIRST — it defines Shared Task **S0** (package skeleton) and Shared Task **S9** (central wiring), plus decisions **D1, D3, D5, D7** which this plan applies. Do not re-paste S0/S9 boilerplate; reference them.

**Goal:** Add `@refkit/provider-internet-archive` — a keyless satellite that searches the Internet Archive Advanced Search API and returns license-normalized `Reference`s for `video` (mediatype `movies`) and `text` (mediatype `texts`) items.

**Architecture:** One factory `internetArchive(config?)` returning `defineProvider({ id: 'internet-archive', modalities: ['video','text'], queryFeatures: ['keyword'], capabilities: { controls: [] }, search })`. `search` builds an `advancedsearch.php` URL, reads `response.docs[]`, maps each doc through `toReference`, and filters out docs whose `mediatype` does not map to a supported modality. Three realities drive the design:

- **Dirty license (D3):** licenseurl is ABSENT on the large majority of items (verified live: a `mediatype:movies` page returned 0/20 docs with a `licenseurl`; only curated CC collections carry one — roughly ~7% overall). Every doc **without** a parseable `licenseurl` → `license: 'unknown'` (core turns that into a `needs-review` verdict). **Never** guess PD, and **never** silently drop the item. (When a `licenseurl` IS present, it is mapped faithfully — including rightsstatements.org statements via the same per-token table as europeana/core `mapRightsUrl`: e.g. `NoC-US` → `PD` + `jurisdiction:'US'`, `InC` → `proprietary`. That is the source's declaration, not a guess, so it does not violate the "never guess PD" rule, which is about the *absent* case.)
- **mediatype → modality (D1):** map `mediatype: 'movies'` → `'video'` and `mediatype: 'texts'` → `'text'`. **v1 scope is exactly these two.** Other mediatypes (`audio`, `image`, `collection`, `software`, `web`, `data`, `etree`) map to `null` and are filtered out of results. Document `audio`/`image`/etc. as a follow-up in the README. Note: `search` returns **both** legs and does not narrow to the caller's `q.modalities` (a `['video']`-only query still yields `texts` items) — this matches the existing single-modality providers, which rely on core routing rather than in-provider modality filtering. If the core merge/client layer does not narrow downstream, add a `q.modalities`-based filter in `search`.
- **CC URL mapping (D5/D7):** when a `licenseurl` is present, regex-map it to a family and (for CC-BY/CC-BY-SA) capture the version.

`text` references may omit the optional `TextMeta` (`reference.ts`: `text?` is optional) — IA search returns no excerpt, so omit it. Canonical/page URL is the details page; thumbnail is the services image endpoint; `preview` is omitted (search exposes no clean direct media stream).

**Tech Stack:** TypeScript (ESM), tsup, vitest, zod (via `@refkit/core`), pnpm workspaces, changesets. Mirror `provider-met` (template + `ctx.fetch` mocking) and `provider-flickr` (license/URL mapper pattern).

---

## Task 1: Decisions & scaffold

- [ ] **1.1: Confirm decisions** — this provider applies **D1** (mediatype→modality, v1 scope = movies/texts only), **D3** (dirty license → `unknown` fallback, never drop, never guess PD), **D5** (CC URL → family), **D7** (CC version from URL for CC-BY / CC-BY-SA).

- [ ] **1.2: Execute Shared Task S0** (see the index) with these substitutions:

  | token | value |
  |---|---|
  | `<id>` | `internet-archive` |
  | `<Fn>` | `internetArchive` |
  | `<Title>` | `Internet Archive` |
  | `<modality>` | `video / text` |
  | `<auth>` | `keyless` |
  | `<licenseCol>` | `per-item CC (dirty) → unknown fallback` |

  Notes:
  - In S0.1, the package directory is `packages/provider-internet-archive`, `package.json` `name` is `@refkit/provider-internet-archive`, and the keywords list ends with `"internet-archive"`. The provider `id` and `referenceId(...)` namespace are also the hyphenated `internet-archive`.
  - The **factory export is camelCase `internetArchive`** (not hyphenated) — only the id/keywords/dir use `internet-archive`.
  - README "Modality" line: `video · text`. Add a short note that v1 covers `movies` (→ video) and `texts` (→ text) only, and that other mediatypes (audio, image, …) are a documented follow-up.
  - S0.2/S0.3/S0.4 unchanged.

---

## Task 2: `mapIaLicense` + `mediatypeToModality` (TDD)

- [ ] **2.1: Write the failing unit test** `packages/provider-internet-archive/src/__tests__/internet-archive.test.ts` covering only the two pure mappers first:

```ts
import { describe, expect, it } from 'vitest'
import { mapIaLicense, mediatypeToModality } from '../index'

describe('mapIaLicense', () => {
  it('maps CC0 / PD mark / PD dedication URLs', () => {
    expect(mapIaLicense('https://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapIaLicense('http://creativecommons.org/publicdomain/mark/1.0/')).toEqual({ license: 'PD' })
  })

  it('maps CC-BY and CC-BY-SA with version (D7)', () => {
    expect(mapIaLicense('https://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapIaLicense('http://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
  })

  it('maps NC/ND variants to proprietary (D5)', () => {
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nc/4.0/').license).toBe('proprietary')
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nd/4.0/').license).toBe('proprietary')
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nc-sa/4.0/').license).toBe('proprietary')
  })

  it('falls back to unknown for absent / unrecognized URLs (D3)', () => {
    expect(mapIaLicense(undefined)).toEqual({ license: 'unknown' })
    expect(mapIaLicense('')).toEqual({ license: 'unknown' })
    expect(mapIaLicense('https://example.com/some-license')).toEqual({ license: 'unknown' })
  })

  it('maps rightsstatements.org faithfully (InC→proprietary, NoC-US→PD+US, opaque→unknown)', () => {
    expect(mapIaLicense('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapIaLicense('http://rightsstatements.org/vocab/NoC-US/1.0/')).toEqual({ license: 'PD', jurisdiction: 'US' })
    expect(mapIaLicense('http://rightsstatements.org/vocab/NoC-NC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapIaLicense('http://rightsstatements.org/vocab/CNE/1.0/')).toEqual({ license: 'unknown' })
  })
})

describe('mediatypeToModality (D1)', () => {
  it('maps movies→video and texts→text', () => {
    expect(mediatypeToModality('movies')).toBe('video')
    expect(mediatypeToModality('texts')).toBe('text')
  })
  it('returns null for unsupported mediatypes (filtered out of v1)', () => {
    expect(mediatypeToModality('audio')).toBeNull()
    expect(mediatypeToModality('image')).toBeNull()
    expect(mediatypeToModality('collection')).toBeNull()
    expect(mediatypeToModality('software')).toBeNull()
  })
})
```

- [ ] **2.2: Run — expect FAIL** (module/exports do not exist yet):

  ```bash
  pnpm --filter @refkit/provider-internet-archive test
  ```
  Expected: FAIL (cannot resolve `../index` / no such exports).

- [ ] **2.3: Implement the mappers** in `packages/provider-internet-archive/src/index.ts`:

```ts
import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId, type Modality,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

const BASE = 'https://archive.org/advancedsearch.php'

export interface InternetArchiveConfig {
  /** Max docs requested per search (advancedsearch `rows`). Default falls back to
   *  the query limit, then 20. Bounded to 100. */
  maxRows?: number
}

// rightsstatements.org is a rights-STATUS vocabulary (not license grants). Mapped faithfully
// per token (mirrors core `mapRightsUrl`; helper-refactor Task 4 dedups this): InC* →
// proprietary; NoC-US → PD scoped to the US; NoC-NC → proprietary; opaque/undetermined → unknown.
const RIGHTS_STATEMENT: Record<string, { license: LicenseId; jurisdiction?: string }> = {
  'inc': { license: 'proprietary' }, 'inc-ow-eu': { license: 'proprietary' }, 'inc-edu': { license: 'proprietary' },
  'inc-nc': { license: 'proprietary' }, 'inc-ruu': { license: 'proprietary' },
  'noc-us': { license: 'PD', jurisdiction: 'US' },
  'noc-nc': { license: 'proprietary' },
  'noc-oklr': { license: 'unknown' }, 'noc-cr': { license: 'unknown' },
  'cne': { license: 'unknown' }, 'und': { license: 'unknown' }, 'nkc': { license: 'unknown' },
}

/** Map an Internet Archive `licenseurl` to our license id (+ CC version, + jurisdiction for
 *  jurisdiction-scoped PD). **ABSENT licenseurl → 'unknown' (D3)** — IA rarely carries one, so
 *  most items legitimately land here → needs-review; this is the "never guess PD" rule and it
 *  governs the ABSENT case only. A PRESENT rightsstatements.org statement is a real declaration
 *  and is mapped faithfully (NoC-US → PD is the source's word, not a guess). NC/ND → proprietary
 *  (D5); PD mark/dedication → PD; CC0 → CC0-1.0; unrecognized → unknown. */
export function mapIaLicense(licenseurl?: string): { license: LicenseId; version?: string; jurisdiction?: string } {
  if (!licenseurl) return { license: 'unknown' }
  const u = licenseurl.toLowerCase()
  const rs = u.match(/rightsstatements\.org\/(?:vocab|page)\/([a-z-]+)/)
  if (rs) return RIGHTS_STATEMENT[rs[1]] ?? { license: 'unknown' }
  if (/\/publicdomain\/zero\b/.test(u)) return { license: 'CC0-1.0' }
  if (/\/publicdomain\/mark\b/.test(u)) return { license: 'PD' }
  // Exclude any NC / ND variant before matching the open by / by-sa families.
  if (/\/licenses\/by-(?:nc|nd)/.test(u)) return { license: 'proprietary' }
  const bySa = u.match(/\/licenses\/by-sa\/(\d(?:\.\d)?)\b/)
  if (bySa) return { license: 'CC-BY-SA', version: bySa[1] }
  const by = u.match(/\/licenses\/by\/(\d(?:\.\d)?)\b/)
  if (by) return { license: 'CC-BY', version: by[1] }
  // by / by-sa with no version still maps to the family (version omitted).
  if (/\/licenses\/by-sa\b/.test(u)) return { license: 'CC-BY-SA' }
  if (/\/licenses\/by\b/.test(u)) return { license: 'CC-BY' }
  return { license: 'unknown' }
}

const MEDIATYPE_MODALITY: Record<string, Modality> = { movies: 'video', texts: 'text' }

/** v1 scope (D1): only `movies`→video and `texts`→text. Everything else → null
 *  (filtered out). audio / image / etc. are a documented follow-up. */
export function mediatypeToModality(mt: string): Modality | null {
  return MEDIATYPE_MODALITY[mt] ?? null
}
```

- [ ] **2.4: Run — expect PASS**:

  ```bash
  pnpm --filter @refkit/provider-internet-archive test
  ```
  Expected: PASS (both `describe` blocks green).

- [ ] **2.5: Commit** — `git add -A && git commit -m "feat(provider-internet-archive): license + mediatype mappers"`

---

## Task 3: `toReference` + `search` (TDD)

- [ ] **3.1: Add the failing integration test** — append to `internet-archive.test.ts`. It mocks `ctx.fetch` to return one `advancedsearch` body whose `response.docs[]` mixes a CC-BY movie (creator string), a movie with NO licenseurl, a `texts` item (creator array), and a `collection` doc that must be filtered out:

```ts
import { evaluateUse, referenceId, type ProviderContext } from '@refkit/core'
import { internetArchive } from '../index'

const DOCS = [
  { // CC-BY movie, creator as a string
    identifier: 'big_buck_bunny',
    title: 'Big Buck Bunny',
    creator: 'Blender Foundation',
    licenseurl: 'https://creativecommons.org/licenses/by/3.0/',
    mediatype: 'movies',
  },
  { // movie with NO licenseurl — must NOT be dropped (D3)
    identifier: 'cbsnews-clip',
    title: 'News Clip',
    creator: 'cbsnews.com',
    mediatype: 'movies',
  },
  { // texts item, creator as an array (IA creator is multi-value)
    identifier: 'alices_adventures',
    title: "Alice's Adventures in Wonderland",
    creator: ['Carroll, Lewis', 'Tenniel, John'],
    licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    mediatype: 'texts',
  },
  { // unsupported mediatype — filtered out (D1)
    identifier: 'some_collection',
    title: 'A Collection',
    mediatype: 'collection',
  },
]

const ctxResponding = (body: unknown, onUrl?: (u: string) => void): ProviderContext => ({
  fetch: (async (input: string) => {
    onUrl?.(String(input))
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch,
})

describe('internetArchive search', () => {
  it('maps CC-BY movie with version + video modality', async () => {
    const refs = await internetArchive().search(
      { text: 'animation', modalities: ['video', 'text'], limit: 10 },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    const bunny = refs.find(r => r.id === referenceId('internet-archive', 'https://archive.org/details/big_buck_bunny'))!
    expect(bunny.modality).toBe('video')
    expect(bunny.rights.license).toBe('CC-BY')
    expect(bunny.rights.licenseVersion).toBe('3.0')
    expect(bunny.rights.author).toBe('Blender Foundation')
    expect(bunny.canonicalUrl).toBe('https://archive.org/details/big_buck_bunny')
    expect(bunny.thumbnail?.url).toBe('https://archive.org/services/img/big_buck_bunny')
    expect(bunny.preview).toBeUndefined()
    expect(evaluateUse(bunny.rights, 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('keeps a licenseurl-less movie as unknown → needs-review (D3, NOT dropped)', async () => {
    const refs = await internetArchive().search(
      { text: 'news', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    const clip = refs.find(r => r.canonicalUrl === 'https://archive.org/details/cbsnews-clip')!
    expect(clip).toBeDefined()
    expect(clip.rights.license).toBe('unknown')
    expect(evaluateUse(clip.rights, 'commercial-product').decision).toBe('needs-review')
  })

  it('maps a texts item to text modality and joins an array creator', async () => {
    const refs = await internetArchive().search(
      { text: 'alice', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    const alice = refs.find(r => r.canonicalUrl === 'https://archive.org/details/alices_adventures')!
    expect(alice.modality).toBe('text')
    expect(alice.rights.license).toBe('CC0-1.0')
    expect(alice.rights.author).toBe('Carroll, Lewis, Tenniel, John')
    expect(alice.text).toBeUndefined()
  })

  it('filters out unsupported mediatypes (collection)', async () => {
    const refs = await internetArchive().search(
      { text: 'x', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 4, docs: DOCS } }),
    )
    expect(refs.map(r => r.canonicalUrl)).not.toContain('https://archive.org/details/some_collection')
    expect(refs).toHaveLength(3) // bunny + clip + alice
  })

  it('forwards query and rows to advancedsearch', async () => {
    let seen = ''
    await internetArchive({ maxRows: 7 }).search(
      { text: 'jazz', modalities: ['video', 'text'] },
      ctxResponding({ response: { numFound: 0, docs: [] } }, u => { seen = u }),
    )
    const url = new URL(seen)
    expect(url.pathname).toBe('/advancedsearch.php')
    expect(url.searchParams.get('q')).toBe('jazz')
    expect(url.searchParams.get('output')).toBe('json')
    expect(url.searchParams.get('rows')).toBe('7')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.getAll('fl[]')).toEqual(
      expect.arrayContaining(['identifier', 'title', 'creator', 'licenseurl', 'mediatype']),
    )
  })
})
```

- [ ] **3.2: Run — expect FAIL** (`internetArchive` / `toReference` / `search` not implemented):

  ```bash
  pnpm --filter @refkit/provider-internet-archive test
  ```
  Expected: FAIL.

- [ ] **3.3: Implement `toReference` + `search`** in `src/index.ts` (append below the mappers):

```ts
interface IaDoc {
  identifier: string
  title?: string
  creator?: string | string[]
  licenseurl?: string
  mediatype: string
}
interface IaResponse { response?: { numFound: number; docs: IaDoc[] } }

function authorOf(creator: string | string[] | undefined): string | undefined {
  if (!creator) return undefined
  return Array.isArray(creator) ? creator.join(', ') || undefined : creator || undefined
}

/** Map one search doc → Reference, or null if its mediatype is out of v1 scope (D1).
 *  canonicalUrl = the details page; thumbnail = the services image endpoint; preview
 *  omitted (search exposes no clean direct media stream). */
export function toReference(doc: IaDoc): Reference | null {
  const modality = mediatypeToModality(doc.mediatype)
  if (!modality) return null
  const canonicalUrl = `https://archive.org/details/${doc.identifier}`
  const { license, version, jurisdiction } = mapIaLicense(doc.licenseurl)
  const rights: RightsRecord = {
    license,
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
    // jurisdiction-scoped PD (e.g. rightsstatements NoC-US → PD in the US)
    ...(jurisdiction ? { jurisdiction } : {}),
    author: authorOf(doc.creator),
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://archive.org/about/terms.php', sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('internet-archive', canonicalUrl),
    modality,
    title: doc.title || undefined,
    source: { providerId: 'internet-archive', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: `https://archive.org/services/img/${doc.identifier}` },
    relevance: 0,
    raw: doc,
  }
}

export function internetArchive(config: InternetArchiveConfig = {}) {
  return defineProvider({
    id: 'internet-archive',
    modalities: ['video', 'text'],
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL(BASE)
      url.searchParams.set('q', q.text)
      for (const f of ['identifier', 'title', 'creator', 'licenseurl', 'mediatype']) {
        url.searchParams.append('fl[]', f)
      }
      url.searchParams.set('output', 'json')
      url.searchParams.set('page', '1')
      const rows = Math.min(config.maxRows ?? q.limit ?? 20, 100)
      url.searchParams.set('rows', String(rows))
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`internet-archive search failed: ${res.status}`)
      const json = (await res.json()) as IaResponse
      const docs = json.response?.docs ?? []
      return docs
        .map(toReference)
        .filter((r): r is Reference => r !== null)
    },
  })
}
```

- [ ] **3.4: Run — expect PASS** (all of Task 2 + Task 3 green):

  ```bash
  pnpm --filter @refkit/provider-internet-archive test
  ```
  Expected: PASS.

- [ ] **3.5: Typecheck the package**:

  ```bash
  pnpm --filter @refkit/provider-internet-archive typecheck
  ```
  Expected: clean.

- [ ] **3.6: Commit** — `git add -A && git commit -m "feat(provider-internet-archive): toReference + search"`

---

## Final Task: Central wiring

- [ ] **F.1: Execute Shared Task S9** (see the index) for a **keyless** provider:
  - **S9.1:** append `'./packages/provider-internet-archive/vitest.config.ts',` to root `vitest.config.ts` `projects`.
  - **S9.2:** add the README table row (after the brave row, ~line 167):
    `| `@refkit/provider-internet-archive` | Internet Archive | video · text | keyless | per-item CC (dirty) → unknown |`
  - **S9.3:** in `packages/mcp/src/cli.ts`, add `import { internetArchive } from '@refkit/provider-internet-archive'` and add `internetArchive()` to the **base** `providers` array (the keyless line that already lists `openverse(), openverseAudio(), …, poetrydb()`).
  - **S9.4:** in `packages/mcp/src/__tests__/mcp.test.ts`, add `'internet-archive'` to the id list in the `'includes every keyless provider by default'` test (~line 230).
  - **S9.5:** add `"@refkit/provider-internet-archive": "workspace:*"` to `packages/mcp/package.json` dependencies.
  - **S9.6:** create `.changeset/provider-internet-archive.md`:
    ```markdown
    ---
    "@refkit/provider-internet-archive": minor
    "@refkit/mcp": minor
    ---

    Add @refkit/provider-internet-archive: Internet Archive as license-normalized video / text references (movies → video, texts → text; dirty per-item CC licenseurl → unknown fallback).
    ```
  - **S9.7:** `pnpm install && pnpm -r typecheck && pnpm test:run` → all green (incl. `provider-internet-archive` and the updated `mcp` test).
  - **S9.8:** `git add -A && git commit -m "feat(provider-internet-archive): Internet Archive satellite (P1)"`

---

## Self-Review

1. **D3 proven:** a movie WITHOUT a `licenseurl` is kept (not dropped) with `license: 'unknown'`, and `evaluateUse(...).decision === 'needs-review'`. PD is never guessed.
2. **D1 proven:** `movies`→`video`, `texts`→`text`; `collection` (and all other mediatypes) filtered out; v1 scope and the audio/image follow-up are documented in the README.
3. **D5/D7 proven:** CC-BY/CC-BY-SA carry `licenseVersion`; NC/ND → `proprietary`; CC0/PD-mark map correctly.
4. **Type validity:** every emitted `Reference` has all required fields and a valid `RightsRecord`; `licenseVersion` set only for CC-BY/CC-BY-SA; `preview` omitted; `text` TextMeta omitted (optional).
5. **Creator robustness:** `authorOf` handles both the string and array forms IA returns.
