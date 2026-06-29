# Provider Helpers in Core — Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a **behavior-preserving refactor** — the safety net is: every provider's existing test suite must stay green after its retrofit. Never change a provider's request output or mapping behavior; only its source of helper functions.

**Goal:** Eliminate the duplicated per-provider URL/license/image helpers by centralizing the shared, stable ones in `@refkit/core`, then retrofit **all** providers that use them to import them. Of the 12 existing provider packages, **11 are retrofitted** — `provider-poetrydb` is excluded because it builds path-based URLs and defines no `setIf*`/searchParams query setters. Plus the 6 Phase-5 plans. `setIfString` alone is currently copy-pasted into 11 providers; the CC-deed-URL→license regex into ~5 of the new plans.

**Architecture:** A new pure-function module `packages/core/src/provider-helpers.ts`, re-exported from `@refkit/core`'s public API. It joins `defineProvider`/`referenceId` (provider-authoring helpers that already live in core), so providers gain these utilities with **zero new dependency** — they already depend only on `@refkit/core`. A separate `@refkit/provider-utils` package was rejected: providers must depend on core regardless (for `defineProvider`, `referenceId`, `Reference`, `RightsRecord`, `LicenseId`, `NormalizedQuery`, `ProviderContext`), and the shared surface is small (~120 LOC), so a new package would only add a publish/versioning layer (see [[provider-roadmap]] discussion).

**Tech Stack:** TypeScript (ESM), vitest, zod (already in core). No new dependencies.

**Scope decision:** centralize ONLY the low-divergence, broadly-shared helpers. Genuinely one-off or behavior-divergent helpers **stay local** (enumerated in Task 3). When unsure, leave it local — over-centralizing helpers that legitimately differ per source is worse than a little duplication.

---

## Divergences found (must be respected — do not flatten blindly)

A survey of the 11 retrofitted providers (all 12 except path-based `provider-poetrydb`) found these real differences the refactor must preserve:

- **`setIfString` empty-string handling — FOUR providers skip-empty-divergent, not one.** `flickr`, `unsplash`, `pexels`, AND `pixabay` all use `if (typeof value !== 'string') return` (no `|| !value`), so they emit `key=` for `''`; the rest skip empty. The canonical helper **skips empty** (the majority, safer behavior). For all four, an empty `''` providerOption value previously produced an empty query param and now produces none — a deliberate, safe improvement (empty escape-hatch params are meaningless), but it IS a behavior change. Each of the four must run its tests after the swap; if any genuinely depends on emitting an empty param (none is expected to), keep that provider's local variant.
- **Boolean encoding:** most use `String(value)` → `"true"/"false"`; flickr's `setBooleanFlag` uses `"1"/"0"`. Canonical `setIfBoolean` = `String(value)`. **flickr keeps `setBooleanFlag` local.**
- **String-list separator + empty edges:** most join with `,`; jamendo (Phase-5) joins tags with a space. Canonical `setIfStringList` takes an optional `separator` (default `,`). It also **skips empty arrays and empty-string elements**, whereas some local variants (artic/flickr `setStringList`) would emit `key=''` for `[]` or accept `['']`. This edge is behavior-divergent for those rows (flagged in the table); real call sites never pass `[]`/`['']`, so it is safe, but note it.
- **Int helpers — reject vs CLAMP is a real behavior split, not just a signature rename.** Four names (`setIfInt`, `setIfPositiveInt`, `setIfNonNegativeInt`, `setIfNumber`) and two `max` behaviors: `flickr`'s `setIfInt` **rejects** when `value > max`; but `pexels`/`unsplash`/`brave`/`smithsonian`/`wikimedia-commons`/`pixabay` **CLAMP** via `Math.min(value, max)`. The canonical helpers default to **reject** and take a `clamp: true` option to clamp instead. Retrofit must pass `{ max, clamp: true }` at the six clamping call sites to preserve behavior; rejecting call sites pass `{ max }`. Also unify the `max` convention onto the `{min?,max?}` bag (call sites passing a positional `max` must be updated). **Without `clamp: true` this swap would silently turn a too-large `per_page` from "clamped to the cap" into "dropped → API default" — and no existing test catches it because all fixtures are within range.**

---

## Task 1: Create `packages/core/src/provider-helpers.ts` (TDD red)

- [ ] **1.1: Write `packages/core/src/__tests__/provider-helpers.test.ts` first.** Cover each canonical helper, including the divergence edge cases above.

```ts
import { describe, expect, it } from 'vitest'
import {
  setIfString, setIfBoolean, setIfStringList,
  setIfInt, setIfPositiveInt, setIfNonNegativeInt, setIfNumber,
  first, mapCcDeedUrl, mapRightsUrl, isLikelyImageUrl, imageMediaType,
} from '../provider-helpers'

const params = (fn: (u: URL) => void) => { const u = new URL('https://x.test/'); fn(u); return u.searchParams }

describe('setIfString', () => {
  it('sets a non-empty string; skips non-strings and empty', () => {
    expect(params(u => setIfString(u, 'a', 'x')).get('a')).toBe('x')
    expect(params(u => setIfString(u, 'a', '')).get('a')).toBeNull()
    expect(params(u => setIfString(u, 'a', 5)).get('a')).toBeNull()
  })
  it('honors an allowlist', () => {
    expect(params(u => setIfString(u, 'a', 'no', ['yes'])).get('a')).toBeNull()
    expect(params(u => setIfString(u, 'a', 'yes', ['yes'])).get('a')).toBe('yes')
  })
})

describe('setIfBoolean', () => {
  it('encodes as true/false strings; skips non-booleans', () => {
    expect(params(u => setIfBoolean(u, 'b', true)).get('b')).toBe('true')
    expect(params(u => setIfBoolean(u, 'b', false)).get('b')).toBe('false')
    expect(params(u => setIfBoolean(u, 'b', 'true')).get('b')).toBeNull()
  })
})

describe('setIfStringList', () => {
  it('joins arrays (default comma), accepts a string, supports a custom separator + allowlist', () => {
    expect(params(u => setIfStringList(u, 't', ['a', 'b'])).get('t')).toBe('a,b')
    expect(params(u => setIfStringList(u, 't', 'solo')).get('t')).toBe('solo')
    expect(params(u => setIfStringList(u, 't', ['a', 'b'], { separator: ' ' })).get('t')).toBe('a b')
    expect(params(u => setIfStringList(u, 't', ['a', 'x'], { allowed: ['a', 'b'] })).get('t')).toBeNull()
    expect(params(u => setIfStringList(u, 't', [])).get('t')).toBeNull()
  })
})

describe('int/number setters', () => {
  it('setIfInt respects min/max and integer-ness', () => {
    expect(params(u => setIfInt(u, 'n', 5)).get('n')).toBe('5')
    expect(params(u => setIfInt(u, 'n', 5.5)).get('n')).toBeNull()
    expect(params(u => setIfInt(u, 'n', 0, { min: 1 })).get('n')).toBeNull()
    expect(params(u => setIfInt(u, 'n', 999, { max: 100 })).get('n')).toBeNull()
  })
  it('setIfPositiveInt defaults to min 1; setIfNonNegativeInt to min 0', () => {
    expect(params(u => setIfPositiveInt(u, 'p', 0)).get('p')).toBeNull()
    expect(params(u => setIfPositiveInt(u, 'p', 1)).get('p')).toBe('1')
    expect(params(u => setIfPositiveInt(u, 'p', 999, { max: 500 })).get('p')).toBeNull()
    expect(params(u => setIfNonNegativeInt(u, 'q', 0)).get('q')).toBe('0')
    expect(params(u => setIfNonNegativeInt(u, 'q', -1)).get('q')).toBeNull()
  })
  it('clamp:true clamps to max instead of rejecting (preserves provider Math.min behavior)', () => {
    expect(params(u => setIfInt(u, 'n', 999, { max: 100, clamp: true })).get('n')).toBe('100')
    expect(params(u => setIfPositiveInt(u, 'p', 999, { max: 500, clamp: true })).get('p')).toBe('500')
    expect(params(u => setIfPositiveInt(u, 'p', 0, { max: 500, clamp: true })).get('p')).toBeNull() // min floor still rejects
    expect(params(u => setIfNonNegativeInt(u, 'q', 999, { max: 200, clamp: true })).get('q')).toBe('200')
  })
  it('setIfNumber allows non-integers', () => {
    expect(params(u => setIfNumber(u, 'f', 1.5, { min: 0, max: 10 })).get('f')).toBe('1.5')
    expect(params(u => setIfNumber(u, 'f', 20, { max: 10 })).get('f')).toBeNull()
  })
})

describe('first', () => {
  it('returns the first element or undefined', () => {
    expect(first(['a', 'b'])).toBe('a')
    expect(first([])).toBeUndefined()
    expect(first(undefined)).toBeUndefined()
  })
})

describe('mapCcDeedUrl', () => {
  it('maps PD/CC0, BY/BY-SA (+version), NC/ND → proprietary, else unknown', () => {
    expect(mapCcDeedUrl('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapCcDeedUrl('https://creativecommons.org/publicdomain/mark/1.0/')).toEqual({ license: 'PD' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toEqual({ license: 'proprietary' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'proprietary' })
    // mapCcDeedUrl is CC-only — a rightsstatements URL has no CC pattern → unknown here
    // (the faithful rightsstatements mapping lives in mapRightsUrl, tested below).
    expect(mapCcDeedUrl('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'unknown' })
    expect(mapCcDeedUrl(undefined)).toEqual({ license: 'unknown' })
    expect(mapCcDeedUrl('https://example.org/x')).toEqual({ license: 'unknown' })
  })
})

describe('mapRightsUrl (CC deeds + faithful rightsstatements.org)', () => {
  it('delegates CC deeds to mapCcDeedUrl', () => {
    expect(mapRightsUrl('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapRightsUrl('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
  })
  it('maps rightsstatements faithfully: InC→proprietary, NoC-US→PD+US, NoC-NC→proprietary', () => {
    expect(mapRightsUrl('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/InC-OW-EU/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-US/1.0/')).toEqual({ license: 'PD', jurisdiction: 'US' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-NC/1.0/')).toEqual({ license: 'proprietary' })
  })
  it('maps opaque/undetermined rightsstatements → unknown', () => {
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-OKLR/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-CR/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/CNE/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/UND/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NKC/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl(undefined)).toEqual({ license: 'unknown' })
  })
})

describe('image helpers', () => {
  it('isLikelyImageUrl: extension / iiif / thumbnail / image CDN', () => {
    expect(isLikelyImageUrl('https://x/y.jpg')).toBe(true)
    expect(isLikelyImageUrl('https://iiif.x/a/full/full/0/default.jpg')).toBe(true)
    expect(isLikelyImageUrl('https://api.europeana.eu/thumbnail/v3/200/a.jpg')).toBe(true)
    expect(isLikelyImageUrl('https://lh3.googleusercontent.com/abc=s0')).toBe(true)
    expect(isLikelyImageUrl('https://www.rijksmuseum.nl/en/collection/SK-A-1')).toBe(false)
  })
  it('imageMediaType: MIME wins, else extension, else default', () => {
    expect(imageMediaType('image/png', 'https://x/y')).toBe('image/png')
    expect(imageMediaType(undefined, 'https://x/y.png')).toBe('image/png')
    expect(imageMediaType(undefined, 'https://x/y.jpg')).toBe('image/jpeg')
    expect(imageMediaType('application/octet-stream', 'https://x/y')).toBe('image/jpeg')
  })
})
```

- [ ] **1.2: Run — expect FAIL** (module does not exist).

```bash
pnpm --filter @refkit/core test -- provider-helpers
```
Expected: FAIL — `Cannot find module '../provider-helpers'`.

---

## Task 2: Implement `provider-helpers.ts` + export (TDD green)

- [ ] **2.1: Write `packages/core/src/provider-helpers.ts`.**

```ts
import type { LicenseId } from './license'

// — URL query-param setters (shared by every provider's search()) —

/** Set `key=value` when value is a non-empty string (optionally within an allowlist). */
export function setIfString(url: URL, key: string, value: unknown, allowed?: readonly string[]): void {
  if (typeof value !== 'string' || !value) return
  if (allowed && !allowed.includes(value)) return
  url.searchParams.set(key, value)
}

/** Set `key=true|false` when value is a boolean. */
export function setIfBoolean(url: URL, key: string, value: unknown): void {
  if (typeof value !== 'boolean') return
  url.searchParams.set(key, String(value))
}

/** Set `key` to a joined list from a string or string[] (default separator ",").
 *  Optional allowlist rejects the whole value if any element is not allowed. */
export function setIfStringList(
  url: URL, key: string, value: unknown,
  opts?: { separator?: string; allowed?: readonly string[] },
): void {
  const sep = opts?.separator ?? ','
  const allowed = opts?.allowed
  const ok = (v: string) => !allowed || allowed.includes(v)
  if (typeof value === 'string' && value && ok(value)) { url.searchParams.set(key, value); return }
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v && ok(v))) {
    url.searchParams.set(key, value.join(sep))
  }
}

/** Set `key` when value is an integer. `min` is a reject floor (value < min → skip).
 *  For `max`: the default REJECTS when value > max; with `clamp: true` it instead sets
 *  `max` — preserving the `Math.min(value, max)` clamp several providers rely on. */
export function setIfInt(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number; clamp?: boolean }): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) return
  if (opts?.min !== undefined && value < opts.min) return
  if (opts?.max !== undefined && value > opts.max) {
    if (opts.clamp) { url.searchParams.set(key, String(opts.max)); return }
    return
  }
  url.searchParams.set(key, String(value))
}

/** Integer ≥ (opts.min ?? 1). Pass `clamp: true` to clamp to `max` instead of rejecting. */
export function setIfPositiveInt(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number; clamp?: boolean }): void {
  setIfInt(url, key, value, { min: opts?.min ?? 1, max: opts?.max, clamp: opts?.clamp })
}

/** Integer ≥ (opts.min ?? 0). Pass `clamp: true` to clamp to `max` instead of rejecting. */
export function setIfNonNegativeInt(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number; clamp?: boolean }): void {
  setIfInt(url, key, value, { min: opts?.min ?? 0, max: opts?.max, clamp: opts?.clamp })
}

/** Set `key` when value is a finite number (non-integers allowed) within [min, max]. */
export function setIfNumber(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number }): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  if (opts?.min !== undefined && value < opts.min) return
  if (opts?.max !== undefined && value > opts.max) return
  url.searchParams.set(key, String(value))
}

// — array helper —

/** First element of an array-typed field, or undefined. */
export function first<T>(arr: T[] | undefined | null): T | undefined {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined
}

// — license: CC deed URL → LicenseId (the moat; shared by URL-based sources) —

/** Map a Creative Commons deed URL to a core LicenseId (+ CC version for the BY/BY-SA
 *  families). Conservative: NC/ND variants → proprietary; PD mark / CC0 → PD / CC0-1.0;
 *  absent/unrecognized → unknown. **CC deeds only** — rightsstatements.org is handled by
 *  `mapRightsUrl`. Match is on the path so http/https both work. */
export function mapCcDeedUrl(url: string | undefined | null): { license: LicenseId; version?: string } {
  if (!url) return { license: 'unknown' }
  const u = url.toLowerCase()
  if (u.includes('creativecommons.org/publicdomain/zero')) return { license: 'CC0-1.0' }
  if (u.includes('creativecommons.org/publicdomain/mark')) return { license: 'PD' }
  // NC / ND are NOT open grants — check before plain by/by-sa ("by-nc-sa" contains "by-sa").
  if (/creativecommons\.org\/licenses\/by-(?:nc|nd)/.test(u)) return { license: 'proprietary' }
  const sa = u.match(/creativecommons\.org\/licenses\/by-sa\/(\d(?:\.\d)?)/)
  if (sa) return { license: 'CC-BY-SA', version: sa[1] }
  const by = u.match(/creativecommons\.org\/licenses\/by\/(\d(?:\.\d)?)/)
  if (by) return { license: 'CC-BY', version: by[1] }
  if (/creativecommons\.org\/licenses\/by-sa\b/.test(u)) return { license: 'CC-BY-SA' }
  if (/creativecommons\.org\/licenses\/by\b/.test(u)) return { license: 'CC-BY' }
  return { license: 'unknown' }
}

// rightsstatements.org is a controlled vocabulary of rights STATUS statements (not license
// grants). Map each token FAITHFULLY to the closest true refkit representation rather than
// collapsing all to unknown — discarding a signal the source did give us is not "honest":
//   • In-Copyright (InC*) → proprietary — we KNOW it's copyrighted with no grant (commercial
//     denied), which is more faithful than "needs-review".
//   • NoC-US → PD scoped to the US via the jurisdiction field (RightsRecord.jurisdiction
//     exists for exactly this; a jurisdiction-aware caller is gated, default stays lenient).
//   • NoC-NC → proprietary — no copyright BUT non-commercial only, so commercial is definitely
//     out (closest honest gate; loses the "non-commercial derivatives OK" nuance, which no
//     LicenseId can express — acceptable approximation).
//   • Opaque/undetermined (NoC-OKLR, NoC-CR, CNE, UND, NKC) → unknown (genuinely needs review).
const RIGHTS_STATEMENT: Record<string, { license: LicenseId; jurisdiction?: string }> = {
  'inc': { license: 'proprietary' }, 'inc-ow-eu': { license: 'proprietary' }, 'inc-edu': { license: 'proprietary' },
  'inc-nc': { license: 'proprietary' }, 'inc-ruu': { license: 'proprietary' },
  'noc-us': { license: 'PD', jurisdiction: 'US' },
  'noc-nc': { license: 'proprietary' },
  'noc-oklr': { license: 'unknown' }, 'noc-cr': { license: 'unknown' },
  'cne': { license: 'unknown' }, 'und': { license: 'unknown' }, 'nkc': { license: 'unknown' },
}

/** Map any rights URI — a CC deed OR a rightsstatements.org statement — to a faithful
 *  LicenseId (+ CC version / source jurisdiction). For sources whose rights field can be
 *  either (europeana `edm:rights`, internet-archive `licenseurl`). CC-only sources should
 *  call `mapCcDeedUrl` directly. Unknown rightsstatements tokens → unknown. */
export function mapRightsUrl(url: string | undefined | null): { license: LicenseId; version?: string; jurisdiction?: string } {
  if (!url) return { license: 'unknown' }
  const rs = url.toLowerCase().match(/rightsstatements\.org\/(?:vocab|page)\/([a-z-]+)/)
  if (rs) return RIGHTS_STATEMENT[rs[1]] ?? { license: 'unknown' }
  return mapCcDeedUrl(url)
}

// — image-URL heuristics (decision D8): preview.url must be an image, never a web page —

export const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?)(?:$|\?)/i

/** URL-string heuristic only (no network): does this look like an image resource? */
export function isLikelyImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url)
    || /iiif/i.test(url)
    || /\/full\/[^/]+\/\d+\/default/i.test(url) // IIIF Image API request path
    || /\/thumbnail\//i.test(url)
    || /googleusercontent\.com/.test(url)        // Rijksmuseum/Met image CDN
}

/** Best image mediaType: declared MIME if image/*, else inferred from extension, else default. */
export function imageMediaType(mime: string | undefined, url: string): string {
  if (mime && mime.startsWith('image/')) return mime
  const m = url.match(IMAGE_EXT)
  if (m) { const e = m[1].toLowerCase(); return e === 'jpg' ? 'image/jpeg' : `image/${e === 'tif' ? 'tiff' : e}` }
  return 'image/jpeg'
}
```

- [ ] **2.2: Export from `packages/core/src/index.ts`.** Add after the `defineProvider` export block:

```ts
export {
  setIfString, setIfBoolean, setIfStringList,
  setIfInt, setIfPositiveInt, setIfNonNegativeInt, setIfNumber,
  first, mapCcDeedUrl, mapRightsUrl, isLikelyImageUrl, imageMediaType, IMAGE_EXT,
} from './provider-helpers'
```

- [ ] **2.3: Run — expect PASS.**

```bash
pnpm --filter @refkit/core test -- provider-helpers
pnpm --filter @refkit/core typecheck
```
Expected: PASS + clean. The rest of core's suite is untouched (purely additive).

- [ ] **2.4: Commit.**

```bash
git add packages/core/src/provider-helpers.ts packages/core/src/__tests__/provider-helpers.test.ts packages/core/src/index.ts
git commit -m "feat(core): shared provider helpers (setIf*, first, mapCcDeedUrl, image heuristics)"
```

---

## Task 3: Retrofit each provider (behavior-preserving) — Shared Recipe `R`

Apply recipe **R** to each provider in the table below, **one provider per task, one commit each**, running that provider's tests after. The providers are independent (each edits only its own `src/index.ts`), so these tasks are parallelizable.

**Recipe R (per provider):**
1. Add the needed names to the existing `import { … } from '@refkit/core'`.
2. Delete the now-redundant local helper functions.
3. Update call sites whose signature changed — specifically any positional `max` → `{ max }` opts bag, and any `setIfStringList`/`setStringList` needing a non-default separator → pass `{ separator }`.
4. Run `pnpm --filter <pkg> test` and `pnpm --filter <pkg> typecheck`. **Both must stay green** — this is the proof the refactor preserved behavior. `noUnusedLocals` will flag any helper you imported but didn't use, or forgot to delete.
5. Commit: `refactor(<pkg>): use shared core provider helpers`.

**Per-provider mapping** (✅ = replace with core import; **keep local** = do NOT centralize):

| Provider | Replace with core import | Call-site changes | Keep local (do not touch) |
|---|---|---|---|
| **provider-met** | `setIfBoolean`, `setIfInt`, `setIfString` | none (met's `setIfInt` had no opts; rejects on bounds — matches canonical default) | — |
| **provider-artic** | `setIfString`, `setIfNonNegativeInt`, `setIfStringList`(rename from `setStringList`, default `,`) | rename `setStringList`→`setIfStringList` call sites; ⚠ canonical skips `[]`/`['']` (artic's emitted them — verify no call site passes those) | **`articFields`** (parses comma/array + injects required fields — provider-specific) |
| **provider-openverse** | `setIfString`, `setIfStringList`, `setIfBoolean`, `setIfPositiveInt`, `setIfNumber` | `setIfNumber(...,{min,max})` already opts-bag → compatible | `hasStringList` (internal field-search detection — openverse-only) |
| **provider-unsplash** | `setIfString` (⚠ does NOT skip empty), `setIfPositiveInt` | positional `max?` → **`{ max, clamp: true }`** (unsplash CLAMPs via Math.min) | `setCollections` |
| **provider-pexels** | `setIfString` (⚠ does NOT skip empty), `setIfPositiveInt` | positional `max?` → **`{ max, clamp: true }`** (pexels CLAMPs) | `pickVideoFile` |
| **provider-pixabay** | `setIfString` (⚠ does NOT skip empty), `setIfStringList`, `setIfNonNegativeInt`, `setIfPositiveInt`, `setIfBoolean` | `setIfPositiveInt`: signature compatible but **body CLAMPs** → pass **`{ max, clamp: true }`** (NOT "already compatible"); `setIfStringList` allowlist → `{ allowed }` | — |
| **provider-gutendex** | `setIfInt`, `setIfPositiveInt`, `setIfString`, `setIfStringList` | `setIfStringList` allowlist → `{ allowed }`; gutendex's int helpers reject on bounds → no `clamp` needed | — |
| **provider-smithsonian** | `setIfString`, `setIfNonNegativeInt` | positional `max?` → **`{ max, clamp: true }`** (smithsonian CLAMPs) | — |
| **provider-brave** | `setIfString`, `setIfPositiveInt`, `setIfBoolean` | positional `max?` → **`{ max, clamp: true }`** (brave CLAMPs) | — |
| **provider-flickr** | `setIfString` (⚠ does NOT skip empty), `setIfInt`, `setStringList`→`setIfStringList` | `setIfInt` opts-bag compatible and **rejects** on max (no `clamp`) — matches canonical default; `setStringList`→`setIfStringList` | **`setBooleanFlag` (1/0), `setIfSafeSearch`, `setTags`, `setStringOrNumber`** |
| **provider-wikimedia-commons** | `setIfString`, `setIfNonNegativeInt`, `setIfPositiveInt`, `setIfBoolean` | `setIfPositiveInt` positional `max?` → **`{ max, clamp: true }`** (wikimedia CLAMPs); `setIfNonNegativeInt` has no max → `{}` | `setPipeList`, `pickTitle` |

- [ ] **3.x (one checkbox per provider above):** apply Recipe R; tests + typecheck green; commit.

> **⚠ empty-string check (Task 3 — applies to flickr, unsplash, pexels, AND pixabay):** all four use `if (typeof value !== 'string') return` (they emit `key=` for `''`); the core `setIfString` skips `''`. After swapping each, run its tests. If any test asserts an empty-string param is emitted, keep that provider's local `setIfString` (rename it, e.g. `setIfStringAllowEmpty`) for the affected call sites and document the keep in a code comment. (Expected: none of the four intentionally emits empty params, so the swap is a clean, safe improvement — but verify per provider, don't assume.)
>
> **⚠ clamp check (Task 3 — applies to unsplash, pexels, brave, smithsonian, wikimedia-commons, pixabay):** all six CLAMP via `Math.min(value, max)`; the core int helpers reject by default. You MUST pass `{ max, clamp: true }` at these call sites. A unit test won't catch a missed `clamp` (all fixtures are in-range), so this is a manual review point — diff each retrofitted `search()` and confirm every former positional-`max` call now carries `clamp: true`.

---

## Task 4: Point the 6 Phase-5 plans at the shared helpers

The Phase-5 provider plans (`2026-06-29-provider-*.md`) currently inline these helpers. They are plans (not yet code), so just update them to import from core when implemented:

- [ ] **4.1:** Replace each plan's inlined license/rights mapper with the right core helper:
  - **CC-only sources** (`jamendo` `mapJamendoLicense`, `rijksmuseum` `mapRijksRights`, `freesound`'s URL branch) → core **`mapCcDeedUrl`**. (freesound's CC **name-string** table stays local and falls back to `mapCcDeedUrl` for URL-form values. rijksmuseum's local was named `mapRijksRights` specifically to avoid clashing with the core `mapRightsUrl`.)
  - **Mixed sources whose rights field can be a CC deed OR a rightsstatements.org statement** (`europeana` `mapEuropeanaRights`, `internet-archive` `mapIaLicense`) → core **`mapRightsUrl`**, which faithfully maps rightsstatements (see below) and delegates CC deeds to `mapCcDeedUrl`. These two must read `jurisdiction` off the result and set `rights.jurisdiction` (for NoC-US).

  Update each plan's tests to import the helper accordingly.

  **⚠ Behavior notes — confirm before swapping:**
  1. **`rightsstatements.org` → faithful mapping (decision: faithful, not blanket-unknown).** `mapRightsUrl` maps rightsstatements statements to their closest TRUE representation: **In-Copyright (InC*) → `proprietary`** (copyrighted, no grant → denied, more faithful than needs-review); **NoC-US → `PD` + `jurisdiction:'US'`** (jurisdiction-scoped PD; default gate stays lenient, jurisdiction-aware callers are gated); **NoC-NC → `proprietary`** (non-commercial → commercial denied); **NoC-OKLR / NoC-CR / CNE / UND / NKC → `unknown`** (opaque/undetermined). This is MORE faithful than the providers' earlier "all rightsstatements → unknown" inlined behavior and REDUCES needs-review noise — update europeana/IA tests to the new verdicts (InC items now `denied`, not `needs-review`; NoC-US now `PD`+`US`). IA's D3 "never guess PD" still holds: it governs items with NO licenseurl (→ unknown); NoC-US→PD is not a guess, it is the source's explicit declaration.
  2. **Versionless `by`/`by-sa` deed URLs.** `mapCcDeedUrl` has a fallback that maps a versionless `.../licenses/by/` (no `/X.Y/`) to `CC-BY` (no version); jamendo/europeana/freesound's inlined regexes return `unknown` for those. After the swap a versionless CC-BY deed URL would map `unknown`→`CC-BY`. This is more correct (the family permission is version-invariant) but IS a behavior change — note it in each plan and confirm no test asserts the old `unknown`.
- [ ] **4.2:** In the `rijksmuseum` plan import **only `isLikelyImageUrl`** (plus `IMAGE_EXT` if its `findImage` references it) from core — rijksmuseum hardcodes its `preview.mediaType` and does **not** use `imageMediaType`, so importing it would be an unused import (`noUnusedLocals` fails). In the `europeana` plan import both `isLikelyImageUrl` and `imageMediaType`. Keep the provider-specific selectors local (`findImage`/`collectDigitalObjects` for rijksmuseum; the `edmIsShownBy` vs `edmIsShownAt` choice for europeana).
- [ ] **4.3:** In all 6 plans, import `setIf*`/`first` from core instead of inlining (per the same mapping as Task 3).
- [ ] **4.4:** Update the index `2026-06-29-p1-providers-index.md` Shared Task S0 note to say: "import shared helpers (`setIf*`, `first`, `mapCcDeedUrl`, `isLikelyImageUrl`, `imageMediaType`) from `@refkit/core` — do not re-inline them (see `2026-06-29-provider-helpers-refactor.md`)."

---

## Task 5: Whole-repo verification + changeset

- [ ] **5.1: Verify the entire monorepo is green** (this is the behavior-preservation proof across all retrofits):

```bash
pnpm install && pnpm -r typecheck && pnpm test:run
```
Expected: every package's typecheck clean; every vitest project green. No test should need editing — if a provider test breaks, the retrofit changed behavior; fix the retrofit, not the test (except flickr's documented empty-string case, if it materializes).

- [ ] **5.2: Changeset.** Core gains exports (minor); every retrofitted provider is an internal refactor (patch).

```markdown
---
"@refkit/core": minor
"@refkit/provider-met": patch
"@refkit/provider-artic": patch
"@refkit/provider-openverse": patch
"@refkit/provider-unsplash": patch
"@refkit/provider-pexels": patch
"@refkit/provider-pixabay": patch
"@refkit/provider-gutendex": patch
"@refkit/provider-smithsonian": patch
"@refkit/provider-brave": patch
"@refkit/provider-flickr": patch
"@refkit/provider-wikimedia-commons": patch
---

Add shared provider helpers to @refkit/core (setIf* URL setters, first, mapCcDeedUrl, image-URL heuristics) and refactor all providers to use them instead of per-package copies.
```

- [ ] **5.3: Final commit** (if not already per-task): `refactor: centralize provider helpers in core`.

---

## Self-Review

1. **No new package** — helpers live in core (providers already depend on it); a separate package was rejected on dependency + size grounds.
2. **Behavior preserved** — every provider's existing tests are the gate; the only intentional behavior question (flickr empty-string) is explicitly flagged with a fallback.
3. **Divergences respected** — boolean `1/0` (flickr), string-list separator (jamendo space), int `{min,max}` bag, and all one-off helpers are kept local, not flattened.
4. **DRY win quantified** — removes 11 copies of `setIfString` and ~5 copies of the CC-deed-URL mapper; centralizes the D8 image heuristic used by 2 providers.
5. **Phase-5 plans aligned** — Task 4 points the 6 unbuilt providers at the shared helpers so they never re-introduce the duplication.
