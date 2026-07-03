# Wave 1 — CC NC/ND License Families Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-NC-ND`, `CC-BY-ND` as first-class license families so NC/ND assets carry faithful rights (attribution generated, verdict reasons name the real license) instead of collapsing to `proprietary`.

**Architecture:** Core-enum + facts change first (compiler drives the exhaustive `LICENSE_PERMISSIVENESS` update), then the shared `mapCcDeedUrl`/`ccVersionFor` helpers (fixes europeana/internet-archive/jamendo centrally), then the three provider-local mappers (openverse, flickr, wikimedia-commons, freesound). `evaluateUse` logic is UNTOUCHED — facts drive it. Decisions H1–H7 in `2026-07-03-hardening-index.md` are locked; do not re-litigate them.

**Tech Stack:** TypeScript ESM, vitest, zod, pnpm workspaces, changesets.

**Working directory:** repo root (the worktree). All paths below are repo-relative. Run tests with `pnpm vitest run <path>` from the root.

---

### Task 1: Core license ids + facts

**Files:**
- Modify: `packages/core/src/license.ts`
- Test: `packages/core/src/__tests__/license.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('LICENSE_FACTS', …)` block:

```ts
  it('CC-BY-ND allows verbatim commercial use but no derivatives', () => {
    expect(LICENSE_FACTS['CC-BY-ND']).toEqual({
      commercialUse: true,
      derivatives: false,
      redistribution: true,
      attributionRequired: true,
      shareAlike: false,
    })
  })

  it('CC-BY-NC family: commercial false, redistribution unknown (intent cannot model NC-only sharing)', () => {
    for (const id of ['CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND'] as const) {
      expect(LICENSE_FACTS[id].commercialUse).toBe(false)
      expect(LICENSE_FACTS[id].redistribution).toBe('unknown')
      expect(LICENSE_FACTS[id].attributionRequired).toBe(true)
    }
    expect(LICENSE_FACTS['CC-BY-NC'].derivatives).toBe(true)
    expect(LICENSE_FACTS['CC-BY-NC-SA'].derivatives).toBe(true)
    expect(LICENSE_FACTS['CC-BY-NC-SA'].shareAlike).toBe(true)
    expect(LICENSE_FACTS['CC-BY-NC-ND'].derivatives).toBe(false)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/__tests__/license.test.ts`
Expected: FAIL — TS error / undefined entries for the new ids.

- [ ] **Step 3: Implement.** In `packages/core/src/license.ts`:

Extend the union (after `'CC-BY-SA'`):

```ts
export type LicenseId =
  | 'CC0-1.0'
  | 'CC-BY'
  | 'CC-BY-SA'
  | 'CC-BY-NC'
  | 'CC-BY-NC-SA'
  | 'CC-BY-NC-ND'
  | 'CC-BY-ND'
  | 'PD'
  | 'unsplash'
  | 'pexels'
  | 'pixabay'
  | 'proprietary'
  | 'unknown'
```

Add to `LICENSE_FACTS` (after the `'CC-BY-SA'` row):

```ts
  // NC family: sharing/derivatives are granted only NON-commercially. The
  // 'redistribution' intent doesn't model commercial vs non-commercial, so the
  // honest tri-state is 'unknown' (→ needs-review) — never true (fail-open) nor
  // false (falsely claims "not granted").
  'CC-BY-NC': { commercialUse: false, derivatives: true, redistribution: 'unknown', attributionRequired: true, shareAlike: false },
  'CC-BY-NC-SA': { commercialUse: false, derivatives: true, redistribution: 'unknown', attributionRequired: true, shareAlike: true },
  'CC-BY-NC-ND': { commercialUse: false, derivatives: false, redistribution: 'unknown', attributionRequired: true, shareAlike: false },
  // ND: verbatim reuse (incl. commercial) is granted; derivatives are not.
  'CC-BY-ND': { commercialUse: true, derivatives: false, redistribution: true, attributionRequired: true, shareAlike: false },
```

- [ ] **Step 4: This breaks the exhaustive `LICENSE_PERMISSIVENESS` in `packages/core/src/rerank.ts` (typed `Record<LicenseId, number>`) and the zod enum in `packages/core/src/rights.ts` — fix both now** (they are part of this atomic step; the build is red until done):

`packages/core/src/rights.ts` — extend `licenseIdSchema`:

```ts
const licenseIdSchema: z.ZodType<LicenseId> = z.enum([
  'CC0-1.0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND', 'PD',
  'unsplash', 'pexels', 'pixabay', 'proprietary', 'unknown',
])
```

`packages/core/src/rerank.ts` — extend the permissiveness table (H4 scores: below `CC-BY-SA` 0.65, above `unknown` 0.3):

```ts
const LICENSE_PERMISSIVENESS: Record<LicenseId, number> = {
  'CC0-1.0': 1, PD: 1,
  unsplash: 0.85, pexels: 0.85, pixabay: 0.85,
  'CC-BY': 0.75, 'CC-BY-SA': 0.65,
  'CC-BY-ND': 0.55, 'CC-BY-NC': 0.45, 'CC-BY-NC-SA': 0.4, 'CC-BY-NC-ND': 0.35,
  unknown: 0.3, proprietary: 0.2,
}
```

- [ ] **Step 5: Run core typecheck + tests**

Run: `pnpm --filter @refkit/core typecheck && pnpm vitest run packages/core`
Expected: PASS (all core suites — nothing else in core reads the enum exhaustively).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/license.ts packages/core/src/rights.ts packages/core/src/rerank.ts packages/core/src/__tests__/license.test.ts
git commit -m "feat(core): add CC-BY-NC/NC-SA/NC-ND/ND license families"
```

---

### Task 2: Strict-deny + attribution coverage for the new families (test-only)

**Files:**
- Test: `packages/core/src/__tests__/evaluate-use.test.ts`
- Test: `packages/core/src/__tests__/attribution.test.ts`
- Test: `packages/core/src/__tests__/rights.test.ts`

No production code changes — `evaluateUse`/`buildAttribution` are facts-driven. These tests prove the two review defects are fixed.

- [ ] **Step 1: evaluate-use tests.** In `evaluate-use.test.ts`, extend the exhaustive list in the strict-deny invariant test (currently `['CC0-1.0', 'CC-BY', 'CC-BY-SA', 'PD', 'unsplash', 'pexels', 'pixabay', 'proprietary', 'unknown']`, ~line 75):

```ts
    const licenses: LicenseId[] = [
      'CC0-1.0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND',
      'PD', 'unsplash', 'pexels', 'pixabay', 'proprietary', 'unknown',
    ]
```

Then add new cases (using the file's existing `rec()` helper):

```ts
  it('CC-BY-NC: commercial denied with the REAL license named, moodboard allowed, redistribution needs-review', () => {
    const commercial = evaluateUse(rec('CC-BY-NC'), 'commercial-product')
    expect(commercial.decision).toBe('denied')
    expect(commercial.reasons.join(' ')).toContain('CC-BY-NC') // not "proprietary"
    expect(evaluateUse(rec('CC-BY-NC'), 'ai-generation-input').decision).toBe('denied')
    expect(evaluateUse(rec('CC-BY-NC'), 'internal-moodboard').decision).toBe('allowed')
    expect(evaluateUse(rec('CC-BY-NC'), 'redistribution').decision).toBe('needs-review')
  })

  it('CC-BY-ND: verbatim commercial allowed-with-attribution, AI-generation denied (derivatives)', () => {
    expect(evaluateUse(rec('CC-BY-ND'), 'commercial-product').decision).toBe('allowed-with-attribution')
    expect(evaluateUse(rec('CC-BY-ND'), 'ai-generation-input').decision).toBe('denied')
    expect(evaluateUse(rec('CC-BY-ND'), 'redistribution').decision).toBe('allowed-with-attribution')
  })
```

- [ ] **Step 2: attribution test.** In `attribution.test.ts` add (match the file's existing import style):

```ts
  it('CC-BY-NC requires attribution (the old proprietary collapse silently dropped it)', () => {
    const a = buildAttribution({
      license: 'CC-BY-NC',
      licenseVersion: '2.0',
      author: 'Bob',
      title: 'mountain',
      canonicalUrl: 'https://example.org/x',
    })
    expect(a.required).toBe(true)
    expect(a.text).toContain('CC-BY-NC 2.0')
    expect(a.text).toContain('Bob')
  })
```

- [ ] **Step 3: rights schema test.** In `rights.test.ts` add:

```ts
  it('accepts the NC/ND family ids with a licenseVersion', () => {
    const r = rightsRecordSchema.parse({
      license: 'CC-BY-NC-ND',
      licenseVersion: '3.0',
      rehostPolicy: 'cache-allowed',
      raw: { sourceTerms: 't', sourceUrl: 'u' },
    })
    expect(r.license).toBe('CC-BY-NC-ND')
  })
```

(Ensure `rightsRecordSchema` is imported; add it to the existing import if absent.)

- [ ] **Step 4: Run**

Run: `pnpm vitest run packages/core`
Expected: PASS — all new tests green with zero production changes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/__tests__/evaluate-use.test.ts packages/core/src/__tests__/attribution.test.ts packages/core/src/__tests__/rights.test.ts
git commit -m "test(core): strict-deny + attribution coverage for NC/ND families"
```

---

### Task 3: Shared helpers — `mapCcDeedUrl` families + `ccVersionFor`

**Files:**
- Modify: `packages/core/src/provider-helpers.ts` (mapCcDeedUrl ~lines 71–91; add helpers)
- Modify: `packages/core/src/index.ts` (export `ccVersionFor`, `CC_FAMILY_BY_TOKEN`)
- Test: `packages/core/src/__tests__/provider-helpers.test.ts`

- [ ] **Step 1: Update the failing tests.** In `provider-helpers.test.ts` the current test (~line 75) asserts `by-nc-nd`/`by-nd` → proprietary. Replace those two assertions and retitle:

```ts
  it('maps PD/CC0, all six CC families (+version), else unknown', () => {
    // …keep the existing PD/CC0/BY/BY-SA assertions unchanged…
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toEqual({ license: 'CC-BY-NC-ND', version: '3.0' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'CC-BY-ND', version: '4.0' })
    expect(mapCcDeedUrl('https://creativecommons.org/licenses/by-nc/2.0/')).toEqual({ license: 'CC-BY-NC', version: '2.0' })
    expect(mapCcDeedUrl('https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en')).toEqual({ license: 'CC-BY-NC-SA', version: '4.0' })
    expect(mapCcDeedUrl('https://creativecommons.org/licenses/by-nc/')).toEqual({ license: 'CC-BY-NC' }) // no version
    expect(mapCcDeedUrl('https://creativecommons.org/licenses/sampling+/1.0/')).toEqual({ license: 'unknown' }) // bespoke, not a family
  })

  it('ccVersionFor: version rides only on versioned CC families', () => {
    expect(ccVersionFor('CC-BY-NC', '2.0')).toBe('2.0')
    expect(ccVersionFor('CC-BY-ND', '4.0')).toBe('4.0')
    expect(ccVersionFor('CC-BY', '4.0')).toBe('4.0')
    expect(ccVersionFor('CC0-1.0', '1.0')).toBeUndefined()
    expect(ccVersionFor('proprietary', '2.0')).toBeUndefined()
    expect(ccVersionFor('CC-BY-NC', undefined)).toBeUndefined()
  })
```

Add `ccVersionFor` to the test file's imports from `../provider-helpers`. The `mapRightsUrl` rightsstatements tests (InC/NoC-*) are UNCHANGED — verify they still pass untouched (H6).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/__tests__/provider-helpers.test.ts`
Expected: FAIL — `ccVersionFor` not exported; NC deeds still map to proprietary.

- [ ] **Step 3: Implement.** In `provider-helpers.ts`, replace the body of `mapCcDeedUrl` (keep `mapRightsUrl` and `RIGHTS_STATEMENT` untouched):

```ts
/** CC deed path token → family LicenseId. Shared by the URL mapper here and by
 *  code-based mappers (e.g. wikimedia-commons extmetadata codes). */
export const CC_FAMILY_BY_TOKEN: Record<string, LicenseId> = {
  'by': 'CC-BY', 'by-sa': 'CC-BY-SA', 'by-nd': 'CC-BY-ND',
  'by-nc': 'CC-BY-NC', 'by-nc-sa': 'CC-BY-NC-SA', 'by-nc-nd': 'CC-BY-NC-ND',
}

/** Map a Creative Commons deed URL to a core LicenseId (+ CC version). All six CC
 *  families map faithfully; PD mark / CC0 → PD / CC0-1.0; bespoke deeds (sampling…)
 *  and absent/unrecognized → unknown. **CC deeds only** — rightsstatements.org is
 *  handled by `mapRightsUrl`. Match is on the path so http/https both work. */
export function mapCcDeedUrl(url: string | undefined | null): { license: LicenseId; version?: string } {
  if (typeof url !== 'string' || !url) return { license: 'unknown' }
  const u = url.toLowerCase()
  if (u.includes('creativecommons.org/publicdomain/zero')) return { license: 'CC0-1.0' }
  if (u.includes('creativecommons.org/publicdomain/mark')) return { license: 'PD' }
  const m = u.match(/creativecommons\.org\/licenses\/(by(?:-nc)?(?:-sa|-nd)?)(?:\/(\d(?:\.\d)?))?/)
  if (m) {
    const license = CC_FAMILY_BY_TOKEN[m[1]]
    if (license) return m[2] ? { license, version: m[2] } : { license }
  }
  return { license: 'unknown' }
}

const CC_VERSIONED_FAMILIES: ReadonlySet<LicenseId> = new Set([
  'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND',
])

/** `version` when `license` is a versioned CC family, else undefined — the shared
 *  licenseVersion guard for provider mappers (replaces the hand-rolled
 *  `license === 'CC-BY' || license === 'CC-BY-SA'` checks). */
export function ccVersionFor(license: LicenseId, version: string | undefined): string | undefined {
  return version !== undefined && CC_VERSIONED_FAMILIES.has(license) ? version : undefined
}
```

In `packages/core/src/index.ts`, extend the provider-helpers export line:

```ts
export {
  setIfString, setIfBoolean, setIfStringList,
  setIfInt, setIfPositiveInt, setIfNonNegativeInt, setIfNumber,
  first, mapCcDeedUrl, mapRightsUrl, ccVersionFor, CC_FAMILY_BY_TOKEN,
  isLikelyImageUrl, imageMediaType, IMAGE_EXT,
} from './provider-helpers'
```

- [ ] **Step 4: Run**

Run: `pnpm vitest run packages/core && pnpm --filter @refkit/core typecheck`
Expected: PASS (regex behavior identical for the old cases: by/by-sa with and without version, sampling → unknown).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/provider-helpers.ts packages/core/src/index.ts packages/core/src/__tests__/provider-helpers.test.ts
git commit -m "feat(core): mapCcDeedUrl maps NC/ND families; add ccVersionFor guard helper"
```

---

### Task 4: Openverse mapper

**Files:**
- Modify: `packages/provider-openverse/src/index.ts` (mapOpenverseLicense ~lines 65–81; two licenseVersion guards ~lines 130, 199)
- Test: `packages/provider-openverse/src/__tests__/openverse.test.ts`, `packages/provider-openverse/src/__tests__/integration.test.ts`

- [ ] **Step 1: Invert the tests.**

`openverse.test.ts` line ~36: `expect(mapOpenverseLicense('by-nc-nd')).toBe('CC-BY-NC-ND')`. Add alongside:

```ts
    expect(mapOpenverseLicense('by-nc')).toBe('CC-BY-NC')
    expect(mapOpenverseLicense('by-nc-sa')).toBe('CC-BY-NC-SA')
    expect(mapOpenverseLicense('by-nd')).toBe('CC-BY-ND')
    expect(mapOpenverseLicense('sampling+')).toBe('proprietary')
```

E2E test ~lines 180–183 (fixture is `by-nc-nd` 2.0): expect `rights.license` `'CC-BY-NC-ND'`, `rights.licenseVersion` `'2.0'`, decision for `commercial-product` STILL `'denied'`, and the reason to contain `'CC-BY-NC-ND'`. Retitle: `'END-TO-END moat: a real by-nc-nd item keeps its family, version, and is denied for commercial use'`.

Audio test ~lines 263–266 (fixture `by-nc` 3.0): expect `'CC-BY-NC'` + `licenseVersion === '3.0'` + still denied.

`integration.test.ts` gate test: assertions stand as-is (NC still gates out of commercial-product); update only the trailing comment to `// CC-BY-NC-ND → commercial denied → filtered`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/provider-openverse`
Expected: FAIL — mapper still returns proprietary.

- [ ] **Step 3: Implement.** Replace the switch and both guards; import `ccVersionFor` from `@refkit/core`:

```ts
export function mapOpenverseLicense(code: string): LicenseId {
  switch (code) {
    case 'cc0': return 'CC0-1.0'
    case 'pdm': return 'PD'
    case 'by': return 'CC-BY'
    case 'by-sa': return 'CC-BY-SA'
    case 'by-nc': return 'CC-BY-NC'
    case 'by-nc-sa': return 'CC-BY-NC-SA'
    case 'by-nc-nd': return 'CC-BY-NC-ND'
    case 'by-nd': return 'CC-BY-ND'
    case 'sampling':
    case 'sampling+':
    case 'nc-sampling+':
      return 'proprietary' // bespoke sampling licences — not clean family grants
    default: return 'unknown'
  }
}
```

Both `toReference` and `toAudioReference`: `licenseVersion: ccVersionFor(license, r.license_version),` and update the doc comment above the mapper (NC/ND now map faithfully; permissions still gate via LICENSE_FACTS).

- [ ] **Step 4: Run** — `pnpm vitest run packages/provider-openverse` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-openverse/src
git commit -m "feat(openverse): map NC/ND codes to their CC families"
```

---

### Task 5: Flickr license table

**Files:**
- Modify: `packages/provider-flickr/src/index.ts` (FLICKR_LICENSE ~lines 50–68; guard ~line 151)
- Test: `packages/provider-flickr/src/__tests__/flickr.test.ts`

- [ ] **Step 1: Invert tests** (~lines 37–39). Keep `'0'` → proprietary (All Rights Reserved). Change/add:

```ts
    expect(mapFlickrLicense('3')).toEqual({ license: 'CC-BY-NC-ND', version: '2.0' })
    expect(mapFlickrLicense('16')).toEqual({ license: 'CC-BY-NC-ND', version: '4.0' })
    expect(mapFlickrLicense('6')).toEqual({ license: 'CC-BY-ND', version: '2.0' })
    expect(mapFlickrLicense('14')).toEqual({ license: 'CC-BY-NC', version: '4.0' })
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/provider-flickr` → FAIL.

- [ ] **Step 3: Implement.** Replace the table rows for 1, 2, 3, 6, 13, 14, 15, 16 (0/4/5/7–12 unchanged):

```ts
  1: { license: 'CC-BY-NC-SA', version: '2.0' },  // CC BY-NC-SA 2.0
  2: { license: 'CC-BY-NC', version: '2.0' },     // CC BY-NC 2.0
  3: { license: 'CC-BY-NC-ND', version: '2.0' },  // CC BY-NC-ND 2.0
  6: { license: 'CC-BY-ND', version: '2.0' },     // CC BY-ND 2.0
  13: { license: 'CC-BY-ND', version: '4.0' },    // CC BY-ND 4.0
  14: { license: 'CC-BY-NC', version: '4.0' },    // CC BY-NC 4.0
  15: { license: 'CC-BY-NC-SA', version: '4.0' }, // CC BY-NC-SA 4.0
  16: { license: 'CC-BY-NC-ND', version: '4.0' }, // CC BY-NC-ND 4.0
```

Guard → `licenseVersion: ccVersionFor(license, version),` (import `ccVersionFor` from `@refkit/core`). Update the table's lead comment: only All Rights Reserved (0) stays proprietary; NC/ND map to their families. `DEFAULT_LICENSE_FILTER` is UNCHANGED (it is a relevance hint listing usable-by-default licenses, not the rights gate).

- [ ] **Step 4: Run** — `pnpm vitest run packages/provider-flickr` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-flickr/src
git commit -m "feat(flickr): map NC/ND numeric ids to their CC families"
```

---

### Task 6: Wikimedia Commons mapper

**Files:**
- Modify: `packages/provider-wikimedia-commons/src/index.ts` (mapCommonsLicense ~lines 33–47; guard ~line 96)
- Test: `packages/provider-wikimedia-commons/src/__tests__/wikimedia-commons.test.ts`

- [ ] **Step 1: Invert tests** (~lines 60–61):

```ts
    expect(mapCommonsLicense('cc-by-nc-2.0')).toEqual({ license: 'CC-BY-NC', version: '2.0' })
    expect(mapCommonsLicense('cc-by-nd-4.0')).toEqual({ license: 'CC-BY-ND', version: '4.0' })
    expect(mapCommonsLicense('cc-by-nc-sa-3.0-de')).toEqual({ license: 'CC-BY-NC-SA', version: '3.0' }) // jurisdiction port
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/provider-wikimedia-commons` → FAIL.

- [ ] **Step 3: Implement** — replace `mapCommonsLicense` with the unified family matcher (import `CC_FAMILY_BY_TOKEN` from `@refkit/core`; keep CC0/PD branches identical, keep unversioned codes → unknown):

```ts
export function mapCommonsLicense(code: string | undefined): { license: LicenseId; version?: string } {
  const c = (code ?? '').trim().toLowerCase()
  if (!c) return { license: 'unknown' }
  if (c === 'cc0' || c.startsWith('cc0-')) return { license: 'CC0-1.0' }
  // tolerate jurisdiction ports (e.g. cc-by-sa-2.5-in, cc-by-3.0-us) — same permission family
  const m = c.match(/^cc-(by(?:-nc)?(?:-sa|-nd)?)-(\d+\.\d+)(?:-[a-z]{2,})?$/)
  if (m) {
    const license = CC_FAMILY_BY_TOKEN[m[1]]
    if (license) return { license, version: m[2] }
  }
  if (c === 'pd' || c.startsWith('pd-') || c.startsWith('public') || c.includes('publicdomain')) {
    return { license: 'PD' }
  }
  return { license: 'unknown' }
}
```

Guard → `licenseVersion: ccVersionFor(license, version),` (add to the `@refkit/core` import). Update the function's lead comment (NC/ND → faithful families).

- [ ] **Step 4: Run** — `pnpm vitest run packages/provider-wikimedia-commons` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-wikimedia-commons/src
git commit -m "feat(wikimedia-commons): map NC/ND codes to their CC families"
```

---

### Task 7: Freesound name map

**Files:**
- Modify: `packages/provider-freesound/src/index.ts` (FREESOUND_NAME_LICENSE ~lines 12–18; guard ~line 73)
- Test: `packages/provider-freesound/src/__tests__/freesound.test.ts`

- [ ] **Step 1: Invert tests.** Lines ~94–95 (`'Attribution NonCommercial'` / `'Attribution Noncommercial'`) → `{ license: 'CC-BY-NC' }` (NO version — D4, name strings carry none). Line ~105 (deed URL form) → `{ license: 'CC-BY-NC', version: '3.0' }`. Line ~45 (fixture-driven rights) → `'CC-BY-NC'`. Sampling+ assertions (~97–98) UNCHANGED (stay proprietary).

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/provider-freesound` → FAIL.

- [ ] **Step 3: Implement.** In `FREESOUND_NAME_LICENSE`: `'attribution noncommercial': { license: 'CC-BY-NC' },` (comment: `// NC family — commercial use still gates to denied`). Sampling entries unchanged. Guard → `licenseVersion: ccVersionFor(license, version),` (import from `@refkit/core`); update the comment on that line (version present only for the deed-URL form).

- [ ] **Step 4: Run** — `pnpm vitest run packages/provider-freesound` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-freesound/src
git commit -m "feat(freesound): map NonCommercial name to CC-BY-NC"
```

---

### Task 8: URL-mapper providers — jamendo, europeana, internet-archive, rijksmuseum

**Files:**
- Modify: `packages/provider-jamendo/src/index.ts:65`, `packages/provider-europeana/src/index.ts:69`, `packages/provider-internet-archive/src/index.ts:59`, `packages/provider-rijksmuseum/src/index.ts:142` (licenseVersion guards only — their mappers delegate to core `mapCcDeedUrl`/`mapRightsUrl`, already fixed by Task 3)
- Test: `packages/provider-jamendo/src/__tests__/jamendo.test.ts`, `packages/provider-europeana/src/__tests__/europeana.test.ts`, `packages/provider-internet-archive/src/__tests__/internet-archive.test.ts`

- [ ] **Step 1: Invert the tests.**

`jamendo.test.ts` ~39–41:

```ts
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toEqual({ license: 'CC-BY-NC-ND', version: '3.0' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nc/2.0/')).toEqual({ license: 'CC-BY-NC', version: '2.0' })
    expect(mapJamendoLicense('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'CC-BY-ND', version: '4.0' })
```

`jamendo.test.ts` E2E ~73–77 (fixture `by-nc-nd/3.0`): expect `rights.license === 'CC-BY-NC-ND'`, `rights.licenseVersion === '3.0'`, commercial decision STILL `'denied'`; retitle to `'maps a CC-BY-NC-ND track faithfully → denied for commercial use'`.

`europeana.test.ts` ~16–18:

```ts
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc/4.0/')).toEqual({ license: 'CC-BY-NC', version: '4.0' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc-sa/4.0/')).toEqual({ license: 'CC-BY-NC-SA', version: '4.0' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'CC-BY-ND', version: '4.0' })
```

rightsstatements assertions (InC/NoC-NC/NoC-US, ~22–24 and the InC E2E) UNCHANGED (H6).

`internet-archive.test.ts` ~16–18:

```ts
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nc/4.0/')).toEqual({ license: 'CC-BY-NC', version: '4.0' })
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'CC-BY-ND', version: '4.0' })
    expect(mapIaLicense('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toEqual({ license: 'CC-BY-NC-SA', version: '4.0' })
```

(If those assertions use `.license` property access instead of `toEqual`, keep their structure and assert both `license` and `version`.) rightsstatements assertions (~28–30) UNCHANGED.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/provider-jamendo packages/provider-europeana packages/provider-internet-archive`
Expected: mapper assertions PASS already via Task 3 (they delegate to core) — but the E2E `licenseVersion` expectations FAIL against the stale `CC-BY || CC-BY-SA` guards.

- [ ] **Step 3: Implement** — in each of the four files replace

```ts
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
```

with

```ts
    licenseVersion: ccVersionFor(license, version),
```

adding `ccVersionFor` to each file's `@refkit/core` import. (rijksmuseum emits only CC0/PD so this is behavior-neutral there — done for consistency so no stale guard survives.)

- [ ] **Step 4: Run**

Run: `pnpm vitest run packages/provider-jamendo packages/provider-europeana packages/provider-internet-archive packages/provider-rijksmuseum`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-jamendo/src packages/provider-europeana/src packages/provider-internet-archive/src packages/provider-rijksmuseum/src
git commit -m "feat(providers): NC/ND families flow through URL-mapped providers via ccVersionFor"
```

---

### Task 9: Full verify, changesets, README

**Files:**
- Create: `.changeset/cc-nc-nd-families.md`
- Modify: `README.md` (only if the providers table's license column mentions NC handling — inspect first; likely no change)

- [ ] **Step 1: Full repo verify**

Run: `pnpm -r typecheck && pnpm test:run`
Expected: ALL green. If any suite not touched above fails (e.g. mcp snapshot of license strings), fix the stale expectation — the license VALUES changed for NC/ND items by design.

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "=== 'CC-BY' || license === 'CC-BY-SA'" packages/*/src/index.ts`
Expected: no matches (all guards migrated). Also run `grep -rn "'proprietary'" packages/*/src/index.ts` and confirm every remaining hit is genuinely non-family (ARR, sampling, copyrighted books, InC/NoC-NC rightsstatements, unsplash/pexels/pixabay platform terms — those are correct).

- [ ] **Step 3: Changeset** — create `.changeset/cc-nc-nd-families.md`:

```md
---
"@refkit/core": minor
"@refkit/provider-openverse": minor
"@refkit/provider-flickr": minor
"@refkit/provider-wikimedia-commons": minor
"@refkit/provider-freesound": minor
"@refkit/provider-jamendo": minor
"@refkit/provider-europeana": minor
"@refkit/provider-internet-archive": minor
---

Add first-class CC NC/ND license families: `CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-NC-ND`, `CC-BY-ND`.

NC/ND-licensed results no longer collapse to `proprietary`: they keep their real
family id (+ CC version), generate the attribution the license requires, and
verdicts name the actual license in their reasons. Gating stays strict-deny —
commercial/AI use of NC content is still denied; NC × `redistribution` intent now
returns `needs-review` (was `denied`) because the intent cannot distinguish
commercial from non-commercial redistribution.

Note for TypeScript consumers: exhaustive `switch` statements over `LicenseId`
need arms for the four new ids.
```

- [ ] **Step 4: Commit**

```bash
git add .changeset/cc-nc-nd-families.md
git commit -m "chore: changeset for CC NC/ND license families"
```

---

## Self-review notes

- Spec coverage: H1 (Task 1), H2/H3 (Tasks 1–2), H4 (Task 1 step 4), H5 (Tasks 3–8 via `ccVersionFor`), H6 (Tasks 3/8 — rightsstatements untouched), H7 (Task 9 changeset).
- `evaluateUse`, `buildAttribution`, MCP, client: zero code changes — facts-driven by design; Task 9's full run proves it.
- Line numbers are anchors, not gospel — locate by the quoted code if drifted.
