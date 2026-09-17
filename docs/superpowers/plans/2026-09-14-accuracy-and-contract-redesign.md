# Accuracy and Contract Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make refkit's default search accurate across keyless sources and move the core contract to its first principles (facts-driven gate, core-completed references, one control registry, one search channel).

**Architecture:** `@refkit/core` stays zero-network and zod-only; providers return `EmittedReference` and core stamps provenance; the orchestrator becomes `select → pipeline stages → cursor loop → meta`; merge takes per-source confidence weights and the lexical reranker runs by default over title + description + tags.

**Tech Stack:** TypeScript strict, pnpm workspace, vitest (`pnpm test:run`), zod 4, tsup.

**Spec:** `docs/superpowers/specs/2026-09-14-accuracy-and-contract-redesign-design.md`

## Global Constraints

- `@refkit/core` depends only on `zod`; no `fetch(` call and no `http(s)://` literal in `packages/core/src` (test-enforced by `no-network.test.ts`).
- Every `@refkit/provider-*` package depends only on `@refkit/core`.
- No compatibility shims, no deprecated aliases: removed surfaces are removed.
- At the end of every task: `pnpm typecheck && pnpm lint && pnpm test:run` all green.
- Commits: conventional prefixes, no attribution / Co-authored-by trailers.
- Type shapes in spec sections D1, D2, D4–D7 are binding (copied into the tasks below).
- Work only inside this worktree; never `git stash`; never push.
- Test files live in `src/__tests__/*.test.ts` per package; run one package with `pnpm --filter @refkit/core test`.

---

### Task 1: License facts drive the gate, merge and reranker

**Files:**
- Modify: `packages/core/src/license.ts`
- Modify: `packages/core/src/rights.ts`
- Modify: `packages/core/src/evaluate-use.ts`
- Modify: `packages/core/src/attribution.ts`
- Modify: `packages/core/src/merge.ts`
- Modify: `packages/core/src/rerank.ts`
- Modify: `packages/core/src/provider-helpers.ts` (remove `CC_VERSIONED_FAMILIES`, `ccVersionFor`; keep the rest)
- Modify: `packages/core/src/client.ts` (pass `facts` into `buildAttribution`)
- Modify: `packages/core/src/index.ts`
- Modify: `packages/provider-testkit/src/index.ts` (import `CC_VERSIONED_FAMILIES` still works — it is re-exported from index; no change needed unless typecheck says so)
- Test: `packages/core/src/__tests__/license.test.ts`, `rights.test.ts`, `evaluate-use.test.ts`, `attribution.test.ts`, `merge.test.ts`, `rerank.test.ts`

**Interfaces:**
- Produces (exported from `@refkit/core`):
  - `type KnownLicenseId`, `type LicenseId = KnownLicenseId | (string & {})`, `isKnownLicenseId(id: string): id is KnownLicenseId`
  - `factsFor(license: LicenseId): LicenseFacts` (unknown id → `LICENSE_FACTS.unknown`)
  - `factsOf(r: Pick<RightsRecord, 'license' | 'facts'>): LicenseFacts`
  - `isIndeterminate(f: LicenseFacts): boolean`
  - `compareRestrictiveness(a: LicenseFacts, b: LicenseFacts): 'a' | 'b' | 'equal' | 'incomparable'`
  - `permissivenessScore(f: LicenseFacts): number`
  - `CC_VERSIONED_FAMILIES`, `ccVersionFor` (now from `license.ts`)
  - `licenseFactsSchema`, `RightsRecord.facts?: LicenseFacts`, `AttributionInput.facts?: LicenseFacts`
- Removed: `stricterLicense`, `LICENSE_PERMISSIVENESS`.

- [ ] **Step 1: Write failing tests for the facts API**

Append to `packages/core/src/__tests__/license.test.ts`:

```ts
import { compareRestrictiveness, factsFor, isIndeterminate, isKnownLicenseId, permissivenessScore, LICENSE_FACTS } from '../license'

describe('facts API', () => {
  it('factsFor falls back to unknown for an id outside the table', () => {
    expect(factsFor('acme-stock')).toEqual(LICENSE_FACTS.unknown)
    expect(isKnownLicenseId('acme-stock')).toBe(false)
    expect(isKnownLicenseId('CC-BY')).toBe(true)
  })
  it('isIndeterminate is true only when all three tri axes are unknown', () => {
    expect(isIndeterminate(LICENSE_FACTS.unknown)).toBe(true)
    expect(isIndeterminate(LICENSE_FACTS['CC-BY-NC'])).toBe(false)
  })
  it('compareRestrictiveness orders by dominance and reports incomparable pairs', () => {
    expect(compareRestrictiveness(LICENSE_FACTS['CC-BY'], LICENSE_FACTS['CC0-1.0'])).toBe('a')
    expect(compareRestrictiveness(LICENSE_FACTS['CC0-1.0'], LICENSE_FACTS['CC-BY'])).toBe('b')
    expect(compareRestrictiveness(LICENSE_FACTS['CC0-1.0'], LICENSE_FACTS.PD)).toBe('equal')
    // unsplash forbids redistribution but needs no attribution; CC-BY is the reverse
    expect(compareRestrictiveness(LICENSE_FACTS.unsplash, LICENSE_FACTS['CC-BY'])).toBe('incomparable')
  })
  it('permissivenessScore is 1 for CC0 and treats unknown as not granted', () => {
    expect(permissivenessScore(LICENSE_FACTS['CC0-1.0'])).toBe(1)
    expect(permissivenessScore(LICENSE_FACTS['CC-BY'])).toBe(0.875)
    expect(permissivenessScore(LICENSE_FACTS.unknown)).toBe(0.25)
    expect(permissivenessScore(LICENSE_FACTS['CC-BY-NC-ND'])).toBe(0.125)
  })
})
```

Append to `packages/core/src/__tests__/rights.test.ts`:

```ts
import { factsOf, rightsRecordSchema } from '../rights'

describe('RightsRecord facts', () => {
  const base = { rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } } as const
  it('accepts a custom license id when facts are supplied', () => {
    const r = rightsRecordSchema.parse({ ...base, license: 'acme-stock', facts: { commercialUse: true, derivatives: false, redistribution: false, attributionRequired: true, shareAlike: false } })
    expect(factsOf(r).derivatives).toBe(false)
  })
  it('a custom id without facts resolves to the unknown row', () => {
    const r = rightsRecordSchema.parse({ ...base, license: 'acme-stock' })
    expect(factsOf(r).commercialUse).toBe('unknown')
  })
  it('facts override the table for a known id', () => {
    const r = rightsRecordSchema.parse({ ...base, license: 'CC-BY', facts: { commercialUse: false, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: false } })
    expect(factsOf(r).commercialUse).toBe(false)
  })
  it('rejects licenseVersion on a non-CC-family license', () => {
    expect(() => rightsRecordSchema.parse({ ...base, license: 'unsplash', licenseVersion: '4.0' })).toThrow()
    expect(() => rightsRecordSchema.parse({ ...base, license: 'CC-BY', licenseVersion: '4.0' })).not.toThrow()
  })
})
```

Append to `packages/core/src/__tests__/evaluate-use.test.ts`:

```ts
describe('facts-driven gate', () => {
  const base = { rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } } as const
  it('gates a custom id by its supplied facts', () => {
    const r = { ...base, license: 'acme-stock', facts: { commercialUse: true, derivatives: false, redistribution: false, attributionRequired: false, shareAlike: false } }
    expect(evaluateUse(r, 'commercial-product').decision).toBe('allowed')
    expect(evaluateUse(r, 'ai-generation-input').decision).toBe('denied')
  })
  it('a custom id without facts is needs-review with low confidence', () => {
    const v = evaluateUse({ ...base, license: 'acme-stock' }, 'internal-moodboard')
    expect(v.decision).toBe('needs-review')
    expect(v.confidence).toBe('low')
  })
})
```

Append to `packages/core/src/__tests__/merge.test.ts` (replace any existing `stricterLicense` tests with these):

```ts
import { compareRestrictiveness, LICENSE_FACTS } from '../license'

describe('cross-source rights resolution (facts)', () => {
  const ref = (providerId: string, license: string, facts?: LicenseFacts): Reference => ({
    id: `${providerId}:1`, modality: 'image', source: { providerId, sourceUrl: 'https://x.test/a' }, canonicalUrl: 'https://x.test/a',
    rights: { license, ...(facts ? { facts } : {}), rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://x.test/a' } },
    verifiedAt: new Date().toISOString(), relevance: 0,
  })
  it('the stricter facts win regardless of id spelling', () => {
    const custom: LicenseFacts = { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: true }
    const out = mergeReferences([[ref('a', 'CC0-1.0')], [ref('b', 'acme-sa', custom)]])
    expect(out[0].rights.license).toBe('acme-sa')
  })
  it('an indeterminate side collapses the conflict to unknown', () => {
    const out = mergeReferences([[ref('a', 'proprietary')], [ref('b', 'unknown')]])
    expect(out[0].rights.license).toBe('unknown')
  })
  it('incomparable facts collapse to unknown', () => {
    const out = mergeReferences([[ref('a', 'unsplash')], [ref('b', 'CC-BY')]])
    expect(out[0].rights.license).toBe('unknown')
    expect(compareRestrictiveness(LICENSE_FACTS.unsplash, LICENSE_FACTS['CC-BY'])).toBe('incomparable')
  })
})
```

(Import `LicenseFacts` and `Reference` types from `../license` / `../reference` at the top of the file.)

Append to `packages/core/src/__tests__/rerank.test.ts`:

```ts
it('license boost is derived from facts: CC0 outranks CC-BY outranks unknown', () => {
  const mk = (id: string, license: string): Reference => ({
    id, modality: 'image', title: 'same', source: { providerId: 'p', sourceUrl: `https://x.test/${id}` }, canonicalUrl: `https://x.test/${id}`,
    rights: { license, rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } }, verifiedAt: new Date().toISOString(), relevance: 0,
  })
  const out = lexicalReranker({ lexicalWeight: 0, qualityWeight: 0, licenseWeight: 1, sourceDiversity: 0 })({ query: 'same', refs: [mk('u', 'unknown'), mk('b', 'CC-BY'), mk('z', 'CC0-1.0')] }) as Reference[]
  expect(out.map(r => r.id)).toEqual(['z', 'b', 'u'])
})
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `pnpm --filter @refkit/core test`
Expected: FAIL — `compareRestrictiveness`, `factsOf`, `isKnownLicenseId` not exported; refine not present.

- [ ] **Step 3: Rewrite `license.ts`**

Replace the file with:

```ts
export const LICENSE_IDS = [
  'CC0-1.0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND', 'PD',
  'unsplash', 'pexels', 'pixabay', 'proprietary', 'unknown',
] as const

export type KnownLicenseId = (typeof LICENSE_IDS)[number]
/** Open id: known ids resolve to LICENSE_FACTS; any other id must ship its own
 *  `facts` on the RightsRecord, else it is treated as `unknown` (strict-deny). */
export type LicenseId = KnownLicenseId | (string & {})

export function isKnownLicenseId(id: string): id is KnownLicenseId {
  return (LICENSE_IDS as readonly string[]).includes(id)
}

/** Three-state: known-true / known-false / not-determinable. Drives strict-deny. */
export type Tri = true | false | 'unknown'

export interface LicenseFacts {
  commercialUse: Tri
  derivatives: Tri
  redistribution: Tri
  attributionRequired: boolean
  shareAlike: boolean
}

// Canonical, auditable license facts for the known ids. Conservative by design:
// anything not clearly granted is false/unknown.
export const LICENSE_FACTS: Record<KnownLicenseId, LicenseFacts> = {
  'CC0-1.0': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: false, shareAlike: false },
  'PD': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: false, shareAlike: false },
  'CC-BY': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: false },
  'CC-BY-SA': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: true },
  // NC family: sharing/derivatives are granted only NON-commercially. The
  // 'redistribution' intent doesn't model commercial vs non-commercial, so the
  // honest tri-state is 'unknown' (→ needs-review).
  'CC-BY-NC': { commercialUse: false, derivatives: true, redistribution: 'unknown', attributionRequired: true, shareAlike: false },
  'CC-BY-NC-SA': { commercialUse: false, derivatives: true, redistribution: 'unknown', attributionRequired: true, shareAlike: true },
  'CC-BY-NC-ND': { commercialUse: false, derivatives: false, redistribution: 'unknown', attributionRequired: true, shareAlike: false },
  // ND: verbatim reuse (incl. commercial) is granted; derivatives are not.
  'CC-BY-ND': { commercialUse: true, derivatives: false, redistribution: true, attributionRequired: true, shareAlike: false },
  // Stock-platform licenses: free incl. commercial, no attribution legally required,
  // but NOT redistributable as-is.
  'unsplash': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'pexels': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'pixabay': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'proprietary': { commercialUse: false, derivatives: false, redistribution: false, attributionRequired: false, shareAlike: false },
  'unknown': { commercialUse: 'unknown', derivatives: 'unknown', redistribution: 'unknown', attributionRequired: false, shareAlike: false },
}

/** Resolve facts for an id; unrecognized → `unknown` (strict-deny fallback). */
export function factsFor(license: LicenseId): LicenseFacts {
  return (LICENSE_FACTS as Record<string, LicenseFacts>)[license] ?? LICENSE_FACTS.unknown
}

/** All three permission axes undeterminable — nothing can be granted or denied. */
export function isIndeterminate(f: LicenseFacts): boolean {
  return f.commercialUse === 'unknown' && f.derivatives === 'unknown' && f.redistribution === 'unknown'
}

// — restrictiveness partial order (used by cross-source conflict resolution) —
// Each axis ranks smaller = stricter. One facts row is "no more permissive" than
// another when it is ≤ on EVERY axis; pairs that each grant something the other
// doesn't are incomparable.
const triRank = (t: Tri): number => (t === true ? 2 : t === 'unknown' ? 1 : 0)

function permissivenessVector(f: LicenseFacts): number[] {
  return [
    triRank(f.commercialUse),
    triRank(f.derivatives),
    triRank(f.redistribution),
    f.attributionRequired ? 0 : 1, // carrying the obligation is stricter
    f.shareAlike ? 0 : 1,
  ]
}

export function compareRestrictiveness(a: LicenseFacts, b: LicenseFacts): 'a' | 'b' | 'equal' | 'incomparable' {
  const va = permissivenessVector(a)
  const vb = permissivenessVector(b)
  let aNoMorePermissive = true
  let bNoMorePermissive = true
  for (let i = 0; i < va.length; i++) {
    if (va[i] > vb[i]) aNoMorePermissive = false
    if (vb[i] > va[i]) bNoMorePermissive = false
  }
  if (aNoMorePermissive && bNoMorePermissive) return 'equal'
  if (aNoMorePermissive) return 'a'
  if (bNoMorePermissive) return 'b'
  return 'incomparable'
}

/** Scalar permissiveness in 0..1 for ranking boosts. Grants weigh 2, obligations 1;
 *  an 'unknown' axis counts as NOT granted, mirroring the strict-deny gate. */
export function permissivenessScore(f: LicenseFacts): number {
  const granted = (t: Tri): number => (t === true ? 1 : 0)
  return (
    2 * granted(f.commercialUse) + 2 * granted(f.derivatives) + 2 * granted(f.redistribution)
    + (f.attributionRequired ? 0 : 1) + (f.shareAlike ? 0 : 1)
  ) / 8
}

// — CC version metadata (attribution/audit only; never read by the gate) —

/** The six versioned CC families — the only ids allowed to carry licenseVersion. */
export const CC_VERSIONED_FAMILIES: ReadonlySet<string> = new Set([
  'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND',
])

/** `version` when `license` is a versioned CC family, else undefined. */
export function ccVersionFor(license: LicenseId, version: string | undefined): string | undefined {
  return version !== undefined && CC_VERSIONED_FAMILIES.has(license) ? version : undefined
}
```

- [ ] **Step 4: Update `rights.ts`**

```ts
import { z } from 'zod'
import { CC_VERSIONED_FAMILIES, factsFor, type LicenseFacts, type LicenseId, type Tri } from './license'

export type RehostPolicy = 'hotlink-required' | 'cache-allowed' | 'thumbnail-only' | 'no-store'

// What a satellite emits per result. Permissions are derived from `license` via
// factsFor() unless the record ships its own `facts` (required for ids outside
// LICENSE_FACTS; an override for known ids whose source terms are narrower).
export interface RightsRecord {
  license: LicenseId
  /** Permission facts for this record. Read via factsOf(); never duplicated elsewhere. */
  facts?: LicenseFacts
  /** Precise CC version ("4.0", "3.0", …) for the six CC families only.
   *  Attribution/audit only — never read by evaluateUse. */
  licenseVersion?: string
  author?: string
  rehostPolicy: RehostPolicy
  /** Source-declared jurisdiction of the PD/copyright status (e.g. 'US'). */
  jurisdiction?: string
  editorialOnly?: boolean
  /** Auditable anchor back to the source's stated terms. */
  raw: { sourceTerms: string; sourceUrl: string }
}

/** The facts that govern a record: its own row when supplied, else the table row. */
export function factsOf(r: Pick<RightsRecord, 'license' | 'facts'>): LicenseFacts {
  return r.facts ?? factsFor(r.license)
}

const triSchema: z.ZodType<Tri> = z.union([z.literal(true), z.literal(false), z.literal('unknown')])

export const licenseFactsSchema: z.ZodType<LicenseFacts> = z.object({
  commercialUse: triSchema,
  derivatives: triSchema,
  redistribution: triSchema,
  attributionRequired: z.boolean(),
  shareAlike: z.boolean(),
})

export const rightsRecordSchema: z.ZodType<RightsRecord> = z.object({
  license: z.string().min(1),
  facts: licenseFactsSchema.optional(),
  licenseVersion: z.string().optional(),
  author: z.string().optional(),
  rehostPolicy: z.enum(['hotlink-required', 'cache-allowed', 'thumbnail-only', 'no-store']),
  jurisdiction: z.string().optional(),
  editorialOnly: z.boolean().optional(),
  raw: z.object({ sourceTerms: z.string(), sourceUrl: z.string() }),
}).refine(
  r => r.licenseVersion === undefined || CC_VERSIONED_FAMILIES.has(r.license),
  { message: 'licenseVersion is only valid on a versioned CC family license' },
)
```

- [ ] **Step 5: Update `evaluate-use.ts`, `attribution.ts`, `merge.ts`, `rerank.ts`, `provider-helpers.ts`, `client.ts`, `index.ts`**

`evaluate-use.ts` — replace the imports and the head of `evaluatePermissions`:

```ts
import { isIndeterminate, type Tri } from './license'
import { factsOf, type RightsRecord } from './rights'
// …
  const facts = factsOf(r)
  const reasons: string[] = []
  const indeterminate = isIndeterminate(facts)
  const confidence: 'high' | 'low' = indeterminate ? 'low' : 'high'
  const base = { reasons, confidence, disclaimer: NOT_LEGAL_ADVICE }

  // Indeterminate facts: never allowed — needs-review regardless of required permissions.
  if (indeterminate) {
    reasons.push('license could not be determined (strict-deny)')
    return { decision: 'needs-review', ...base }
  }
```
Everything else in the function is unchanged (it already reads `facts[perm]`).

`attribution.ts`:

```ts
import { type LicenseFacts, type LicenseId } from './license'
import { factsOf } from './rights'

export interface AttributionInput {
  license: LicenseId
  facts?: LicenseFacts
  licenseVersion?: string
  canonicalUrl: string
  author?: string
  title?: string
}
// in buildAttribution:
  const facts = factsOf(input)
```

`merge.ts` — delete `triRank`, `permissivenessVector`, `stricterLicense`; replace `resolveRightsConflict`:

```ts
import { compareRestrictiveness, isIndeterminate, type LicenseId } from './license'
import { factsOf, type RightsRecord } from './rights'

function unknownRecord(anchor: RightsRecord): RightsRecord {
  // No honest single license exists for the conflict: strict-deny to 'unknown'.
  // Keep the anchor's per-item data as the audit trail; drop facts/version that
  // only made sense for the original id.
  return { ...anchor, license: 'unknown', licenseVersion: undefined, facts: undefined }
}

function resolveRightsConflict(current: RightsRecord, incoming: RightsRecord): RightsRecord {
  const fa = factsOf(current)
  const fb = factsOf(incoming)
  // An indeterminate side grants nothing determinable — the conflict can only
  // resolve to unknown.
  if (isIndeterminate(fa) || isIndeterminate(fb)) return unknownRecord(current)
  const cmp = compareRestrictiveness(fa, fb)
  if (cmp === 'a' || cmp === 'equal') return current
  if (cmp === 'b') return incoming
  return unknownRecord(current)
}
```
`RightsConflict.licenses` and `resolvedLicense` keep type `LicenseId`.

`rerank.ts` — delete `LICENSE_PERMISSIVENESS`; import `permissivenessScore` from `./license` and `factsOf` from `./rights`; in the scoring line use `licW * permissivenessScore(factsOf(ref.rights))`.

`provider-helpers.ts` — delete the `CC_VERSIONED_FAMILIES` and `ccVersionFor` definitions (lines under "Canonical membership set…"); keep `mapCcDeedUrl`, `mapRightsUrl`, `CC_FAMILY_BY_TOKEN` etc. `mapCcDeedUrl` needs no version helper.

`client.ts` — in the returned `buildAttribution`, add `facts: ref.rights.facts,`.

`index.ts` — replace the license/rights/merge/helpers export lines with:

```ts
export { LICENSE_FACTS, LICENSE_IDS, factsFor, isKnownLicenseId, isIndeterminate, compareRestrictiveness, permissivenessScore, CC_VERSIONED_FAMILIES, ccVersionFor } from './license'
export type { LicenseId, KnownLicenseId, LicenseFacts, Tri } from './license'
export type { RehostPolicy, RightsRecord } from './rights'
export { rightsRecordSchema, licenseFactsSchema, factsOf } from './rights'
// …
export { mergeReferences } from './merge'
// … and drop CC_VERSIONED_FAMILIES / ccVersionFor from the provider-helpers export line
```

- [ ] **Step 6: Fix remaining compile errors and old tests**

Run `pnpm typecheck`. Update any test that imported `stricterLicense` (replace with the facts tests from Step 1) or asserted the exact old permissiveness numbers. MCP `evaluate_use` / `build_attribution` keep `z.enum(LICENSE_IDS)` — no MCP change.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test:run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A packages/core packages/provider-testkit
git commit -m "refactor(core): license facts drive the gate, merge and reranker"
```

---

### Task 2: Delete the legacy filters / queryFeatures channels

**Files:**
- Modify: `packages/core/src/provider.ts`, `packages/core/src/query.ts`, `packages/core/src/client.ts`, `packages/core/src/index.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/core/src/__tests__/query.test.ts`, `client.test.ts`, `provider.test.ts`; `packages/mcp/src/__tests__/mcp.test.ts`; `packages/provider-unsplash/src/__tests__/unsplash.test.ts`, `packages/provider-pexels/src/__tests__/pexels.test.ts`, `packages/provider-pixabay/src/__tests__/pixabay.test.ts`

**Interfaces:**
- Removed: `QueryFeature`, `SearchFilters`, `ReferenceProvider.queryFeatures`, `NormalizedQuery.filters`, `SearchInput.filters`, `SearchMeta.appliedFilters`, `mergeSearchControls`, MCP `filters` parameter and `appliedFilters` in its meta schema.
- Produces: `normalizeQuery(input: { query, modalities, controls?, providerOptions?, limit? }, provider)`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/__tests__/query.test.ts`:

```ts
it('routes only the controls a provider declares in capabilities.controls; a provider without capabilities gets none', () => {
  const p = defineProvider({ id: 'p', modalities: ['image'], capabilities: { controls: ['color'] }, search: async () => [] })
  const q = normalizeQuery({ query: 'x', modalities: ['image'], controls: { color: 'red', orientation: 'landscape' } }, p)
  expect(q.controls).toEqual({ color: 'red' })
  expect('filters' in q).toBe(false)
  const bare = defineProvider({ id: 'b', modalities: ['image'], search: async () => [] })
  expect(normalizeQuery({ query: 'x', modalities: ['image'], controls: { color: 'red' } }, bare).controls).toBeUndefined()
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @refkit/core test`
Expected: FAIL on `'filters' in q` (the mirror is still emitted).

- [ ] **Step 3: Remove the legacy surface in core**

`provider.ts`: delete `QueryFeature`, `SearchFilters`, the `queryFeatures` member and the `filters` member of `NormalizedQuery` (with their doc comments).

`query.ts`: delete `LEGACY_FEATURE_CONTROLS`, `controlsFromFilters`, `mergeSearchControls`; replace `effectiveControlCaps` with:

```ts
function effectiveControlCaps(provider: ReferenceProvider): readonly SearchControlKey[] {
  return provider.capabilities?.controls ?? []
}
```

Replace `normalizeControlsForProvider` and `normalizeQuery`:

```ts
export function normalizeControlsForProvider(controls: SearchControls | undefined, provider: ReferenceProvider): SearchControls | undefined {
  if (!controls) return undefined
  const supported = supportedControlKeys(provider, controls)
  if (supported.length === 0) return undefined
  const out: SearchControls = {}
  for (const key of supported) setControl(out, key, controls)
  return out
}

export function normalizeQuery(
  input: { query: string; modalities: Modality[]; controls?: SearchControls; providerOptions?: ProviderOptionsById; limit?: number },
  provider: ReferenceProvider,
): NormalizedQuery {
  const controls = normalizeControlsForProvider(input.controls, provider)
  return {
    text: input.query,
    modalities: input.modalities.filter(m => provider.modalities.includes(m)),
    ...(controls ? { controls } : {}),
    ...(input.providerOptions?.[provider.id] ? { providerOptions: input.providerOptions[provider.id] } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  }
}
```

`client.ts`: remove `SearchFilters` import and `mergeSearchControls` import; delete `SearchInput.filters` and `SearchMeta.appliedFilters`; in `runPass` use `const requestedControls = requestedControlKeys(controls ?? {})` and pass `controls ?? {}` to `supportedControlKeys`/`unsupportedControlKeys`; drop `filters: input.filters` from the `normalizeQuery` call; drop the `appliedFilters` spread from meta.

`index.ts`: remove `QueryFeature` and `SearchFilters` from the type export list.

- [ ] **Step 4: Remove the MCP filters parameter**

In `packages/mcp/src/index.ts`: delete `filtersSchema`, the `filters` entry of `inputSchema`, the `filters` destructure and `filters:` line in `searchInput`, the `appliedFilters` line in `searchMetaSchema`, and the `SearchFilters` type import.

- [ ] **Step 5: Update tests**

- `query.test.ts`: delete the cases titled "routes legacy filters…", "legacy compat…", "capabilities, once declared, win over queryFeatures", "omits filters entirely…", "maps legacy filters into controls…", "prefers primary controls over conflicting legacy filters…". Keep the rest.
- `provider.test.ts`: replace `queryFeatures: [...]` in fixtures with `capabilities: { controls: [...] }` (map `orientation` → `'orientation'`, `keyword` → nothing).
- `client.test.ts`: delete cases whose subject is `filters` / `appliedFilters`; where a case merely passes `filters: { … }` incidentally, rewrite it as `controls: { … }`.
- `mcp.test.ts`: same rule — delete filters-subject cases, convert incidental uses.
- `unsplash.test.ts`, `pexels.test.ts`, `pixabay.test.ts`: delete the "keeps primary controls ahead of conflicting legacy filters…" cases (and any other case passing `filters:`).

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test:run`
Expected: green; `grep -rn "filters\|queryFeatures" packages/*/src --include='*.ts'` returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A packages
git commit -m "refactor: remove the legacy filters and queryFeatures channels"
```

---

### Task 3: One control registry; zod schemas exported from core and reused by MCP

**Files:**
- Create: `packages/core/src/controls.ts`
- Create: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/modality.ts`, `provider.ts`, `query.ts`, `reference.ts`, `client.ts`, `index.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/core/src/__tests__/controls.test.ts` (new), `packages/mcp/src/__tests__/mcp.test.ts`

**Interfaces:**
- Produces (from `@refkit/core`): `MODALITIES` tuple; `CONTROL_PATHS`, `SEARCH_CONTROL_KEYS`, `getControl`, `setControl`, `hasControl`, `buildSearchControlsSchema(kinds?)`, `searchControlsSchema`; `PROVIDER_SKIP_REASONS`, `ProviderSkipReason`; `searchMetaSchema`, `providerSearchStatusSchema`, `searchControlKeySchema`.
- `SearchControlKey` is now `keyof typeof CONTROL_PATHS`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/controls.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CONTROL_PATHS, SEARCH_CONTROL_KEYS, buildSearchControlsSchema, getControl, hasControl, setControl, type SearchControls } from '../controls'

describe('control registry', () => {
  it('lists every key exactly once and in registry order', () => {
    expect(SEARCH_CONTROL_KEYS).toEqual(Object.keys(CONTROL_PATHS))
    expect(new Set(SEARCH_CONTROL_KEYS).size).toBe(SEARCH_CONTROL_KEYS.length)
    expect(SEARCH_CONTROL_KEYS).toContain('license.commercial')
    expect(SEARCH_CONTROL_KEYS).toContain('page')
  })
  it('get/set/has walk nested paths', () => {
    const c: SearchControls = { license: { commercial: true }, page: 2 }
    expect(getControl(c, 'license.commercial')).toBe(true)
    expect(getControl(c, 'media.kind')).toBeUndefined()
    expect(hasControl(c, 'page')).toBe(true)
    const out: SearchControls = {}
    setControl(out, 'media.kind', 'photo')
    setControl(out, 'media.minWidth', 100)
    setControl(out, 'sort', 'latest')
    expect(out).toEqual({ media: { kind: 'photo', minWidth: 100 }, sort: 'latest' })
  })
  it('schema accepts any kind by default and only the given kinds when restricted', () => {
    expect(buildSearchControlsSchema().safeParse({ media: { kind: 'anything' } }).success).toBe(true)
    expect(buildSearchControlsSchema(['photo']).safeParse({ media: { kind: 'texture' } }).success).toBe(false)
    expect(buildSearchControlsSchema(['photo']).safeParse({ media: { kind: 'photo' }, page: 1 }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @refkit/core test`
Expected: FAIL — module `../controls` not found.

- [ ] **Step 3: Create `controls.ts`**

```ts
import { z } from 'zod'

export type SearchSort = 'relevance' | 'latest' | 'popular' | 'interesting'
export type SearchSafety = 'strict' | 'moderate' | 'off'

/** Fine-grained resource kind. Open vocabulary: well-known values get
 *  autocomplete; any other string is a valid custom kind. */
export type WellKnownKind =
  | 'photo' | 'illustration' | 'vector' | 'icon' | 'artwork'
  | 'texture' | 'hdri' | '3d-model'
  | 'film' | 'animation'
  | 'music' | 'sound-effect'
  | 'ebook' | 'poem'
export type ResourceKind = WellKnownKind | (string & {})

export interface SearchLicenseControls {
  commercial?: boolean
  modification?: boolean
  allowUnknown?: boolean
}
export interface SearchMediaControls {
  kind?: ResourceKind
  size?: 'small' | 'medium' | 'large'
  minWidth?: number
  minHeight?: number
  duration?: 'short' | 'medium' | 'long'
}
export interface SearchCreatorControls { id?: string; name?: string }
export interface SearchTextControls { copyright?: 'public-domain' | 'copyrighted' | 'any' }

export interface SearchControls {
  orientation?: 'landscape' | 'portrait' | 'square'
  color?: string
  language?: string
  sort?: SearchSort
  safety?: SearchSafety
  license?: SearchLicenseControls
  media?: SearchMediaControls
  creator?: SearchCreatorControls
  text?: SearchTextControls
  /** Provider-local page (1-based): each provider paginates its own stream. */
  page?: number
}

/** The single control registry: every routable control as its path inside
 *  SearchControls. The key union, key list, accessors and zod schema all derive
 *  from this table — adding a control means adding one row here (and one field
 *  in SearchControls + the schema builder below). */
export const CONTROL_PATHS = {
  orientation: ['orientation'],
  color: ['color'],
  language: ['language'],
  sort: ['sort'],
  safety: ['safety'],
  'license.commercial': ['license', 'commercial'],
  'license.modification': ['license', 'modification'],
  'license.allowUnknown': ['license', 'allowUnknown'],
  'media.kind': ['media', 'kind'],
  'media.size': ['media', 'size'],
  'media.minWidth': ['media', 'minWidth'],
  'media.minHeight': ['media', 'minHeight'],
  'media.duration': ['media', 'duration'],
  'creator.id': ['creator', 'id'],
  'creator.name': ['creator', 'name'],
  'text.copyright': ['text', 'copyright'],
  page: ['page'],
} as const satisfies Record<string, readonly [keyof SearchControls] | readonly [keyof SearchControls, string]>

export type SearchControlKey = keyof typeof CONTROL_PATHS
export const SEARCH_CONTROL_KEYS = Object.keys(CONTROL_PATHS) as SearchControlKey[]

type Path = readonly [keyof SearchControls, string?]

export function getControl(controls: SearchControls, key: SearchControlKey): unknown {
  const [head, tail] = CONTROL_PATHS[key] as Path
  const value = controls[head]
  return tail === undefined ? value : (value as Record<string, unknown> | undefined)?.[tail]
}

export function hasControl(controls: SearchControls, key: SearchControlKey): boolean {
  return getControl(controls, key) !== undefined
}

/** Write `value` at the key's path (creating the nested group as needed). */
export function setControl(out: SearchControls, key: SearchControlKey, value: unknown): void {
  const [head, tail] = CONTROL_PATHS[key] as Path
  const target = out as Record<string, unknown>
  if (tail === undefined) { target[head] = value; return }
  target[head] = { ...((target[head] as Record<string, unknown> | undefined) ?? {}), [tail]: value }
}

/** Zod schema for SearchControls. `kinds` restricts media.kind to a closed enum
 *  (the MCP server passes the union of registered providers' kinds). */
export function buildSearchControlsSchema(kinds?: readonly string[]): z.ZodType<SearchControls> {
  const kind = kinds && kinds.length > 0 ? z.enum(kinds as [string, ...string[]]) : z.string()
  return z.object({
    orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
    color: z.string().optional(),
    language: z.string().optional(),
    sort: z.enum(['relevance', 'latest', 'popular', 'interesting']).optional(),
    safety: z.enum(['strict', 'moderate', 'off']).optional(),
    license: z.object({
      commercial: z.boolean().optional(),
      modification: z.boolean().optional(),
      allowUnknown: z.boolean().optional(),
    }).optional(),
    media: z.object({
      kind: kind.optional(),
      size: z.enum(['small', 'medium', 'large']).optional(),
      minWidth: z.number().int().nonnegative().optional(),
      minHeight: z.number().int().nonnegative().optional(),
      duration: z.enum(['short', 'medium', 'long']).optional(),
    }).optional(),
    creator: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
    text: z.object({ copyright: z.enum(['public-domain', 'copyrighted', 'any']).optional() }).optional(),
    page: z.number().int().positive().optional(),
  })
}

export const searchControlsSchema: z.ZodType<SearchControls> = buildSearchControlsSchema()
```

- [ ] **Step 4: Rewire `provider.ts`, `query.ts`, `modality.ts`, `reference.ts`, `client.ts`**

`modality.ts`:
```ts
export const MODALITIES = ['image', 'video', 'audio', 'text'] as const
export type Modality = (typeof MODALITIES)[number]
```
`reference.ts`: `const modalitySchema: z.ZodType<Modality> = z.enum(MODALITIES)` (import `MODALITIES`).

`provider.ts`: delete the moved type definitions (`SearchSort` … `SearchControlKey`) and re-export them for internal consumers: `export type { SearchControls, SearchControlKey, SearchSort, SearchSafety, WellKnownKind, ResourceKind, SearchLicenseControls, SearchMediaControls, SearchCreatorControls, SearchTextControls } from './controls'`; keep `ProviderCapabilities { controls: readonly SearchControlKey[] }`, `ProviderOptions*`, `NormalizedQuery`, `KeyValueCache`, `ProviderContext`, `ReferenceProvider`, `defineProvider`.

`query.ts`: delete the local `hasControl`, `setControl`, and the `allControlKeys` array; import `{ SEARCH_CONTROL_KEYS, getControl, hasControl, setControl }` from `./controls`;

```ts
export function requestedControlKeys(controls: SearchControls): SearchControlKey[] {
  return SEARCH_CONTROL_KEYS.filter(key => hasControl(controls, key))
}
// … in normalizeControlsForProvider:
  for (const key of supported) setControl(out, key, getControl(controls, key))
```

`client.ts`: add near the top
```ts
export const PROVIDER_SKIP_REASONS = ['unsupported-modality', 'unsupported-kind', 'not-selected'] as const
export type ProviderSkipReason = (typeof PROVIDER_SKIP_REASONS)[number]
```
and use `reason?: ProviderSkipReason` in `ProviderSearchStatus`; replace the inline `NonNullable<ProviderSearchStatus['reason']>` usages with `ProviderSkipReason`.

- [ ] **Step 5: Create `schemas.ts`**

```ts
import { z } from 'zod'
import { MODALITIES } from './modality'
import { SEARCH_CONTROL_KEYS } from './controls'
import { INTENTS } from './evaluate-use'
import { PROVIDER_SKIP_REASONS, type ProviderSearchStatus, type SearchMeta } from './client'

export const searchControlKeySchema = z.enum(SEARCH_CONTROL_KEYS as [string, ...string[]])

export const providerSearchStatusSchema: z.ZodType<ProviderSearchStatus> = z.object({
  providerId: z.string(),
  status: z.enum(['fulfilled', 'failed', 'skipped']),
  returned: z.number().optional(),
  accepted: z.number().optional(),
  rejected: z.number().optional(),
  reason: z.enum(PROVIDER_SKIP_REASONS).optional(),
  error: z.string().optional(),
  latencyMs: z.number().optional(),
  cached: z.boolean().optional(),
})

export const searchMetaSchema: z.ZodType<SearchMeta> = z.object({
  query: z.string(),
  modalities: z.array(z.enum(MODALITIES)),
  limit: z.number(),
  poolFactor: z.number(),
  fetchLimit: z.number(),
  controls: z.object({
    requested: z.array(searchControlKeySchema),
    appliedByProvider: z.record(z.string(), z.array(searchControlKeySchema)),
    ignoredByProvider: z.record(z.string(), z.array(searchControlKeySchema)),
  }).optional(),
  providerOptions: z.array(z.string()).optional(),
  providers: z.array(providerSearchStatusSchema),
  gate: z.object({ intent: z.enum(INTENTS), before: z.number(), after: z.number(), dropped: z.number() }).optional(),
  nextCursor: z.string().optional(),
  warnings: z.array(z.string()),
}) as z.ZodType<SearchMeta>
```
(If zod's inferred type for `controls.requested` is `string[]` and TypeScript rejects the `z.ZodType<SearchMeta>` annotation, keep the trailing `as z.ZodType<SearchMeta>` cast — the runtime enum is the exact key list.)

`index.ts` additions:
```ts
export { MODALITIES } from './modality'
export { CONTROL_PATHS, SEARCH_CONTROL_KEYS, getControl, setControl, hasControl, buildSearchControlsSchema, searchControlsSchema } from './controls'
export { searchMetaSchema, providerSearchStatusSchema, searchControlKeySchema } from './schemas'
export { PROVIDER_SKIP_REASONS } from './client'
export type { ProviderSkipReason } from './client'
```
(Keep exporting the control types via the existing `from './provider'` type block or move them to `from './controls'` — either is fine, but each name must be exported exactly once.)

- [ ] **Step 6: MCP reuses the core schemas**

In `packages/mcp/src/index.ts`: delete `MODALITIES`, `ORIENTATIONS`, `SEARCH_CONTROL_KEYS`, `searchControlKeySchema`, `buildSearchControlsSchema`, `searchMetaSchema`. Import `{ buildSearchControlsSchema, searchMetaSchema, MODALITIES }` from `@refkit/core` (plus what it already imports). Keep `BASE_MEDIA_KINDS` and build `const searchControlsSchema = buildSearchControlsSchema(kindValues)`. `outputSchema.meta: searchMetaSchema.optional()` stays. Delete the `SearchControlKey`/`SearchMeta` type imports if unused.

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:run` — green. Also `grep -n "'orientation'" packages/mcp/src/index.ts` must show no hand-written control key list.

```bash
git add -A packages/core packages/mcp
git commit -m "refactor(core,mcp): single control registry and core-exported search schemas"
```

---

### Task 4: Providers emit, core completes — EmittedReference contract, okJson, default User-Agent, provider migration

**Files:**
- Modify: `packages/core/src/reference.ts`, `provider.ts`, `provider-run.ts`, `provider-helpers.ts`, `resilience.ts`, `client.ts`, `index.ts`
- Modify: `packages/provider-testkit/src/index.ts`
- Modify: every `packages/provider-*/src/index.ts` (19 packages) and their tests
- Modify: `packages/mcp/src/__tests__/mcp.test.ts`, `packages/core/src/__tests__/*.test.ts` fakes that return `Reference` from `search`
- Test: `packages/core/src/__tests__/reference.test.ts`, `provider-run.test.ts`, `resilience.test.ts`, `client.test.ts`

**Interfaces:**
- Produces (from `@refkit/core`):
  ```ts
  interface EmittedReference {
    modality: Modality; kind?: string; title?: string; description?: string; tags?: string[]
    sourceUrl: string; canonicalUrl?: string; rights: RightsRecord
    thumbnail?: ReferenceMedia; preview?: MediaPreview; perceptualHash?: string
    visual?: VisualMeta; text?: TextMeta; sourceScore?: number; raw?: unknown
  }
  interface Reference { id: string; modality; kind?; title?; description?; tags?; source: { providerId; sourceUrl }; canonicalUrl: string; rights; verifiedAt: string; thumbnail?; preview?; perceptualHash?; visual?; text?; relevance: number; sourceScore?; raw? }
  emittedReferenceSchema; parseEmitted(input): EmittedReference
  completeReference(providerId: string, e: EmittedReference, now: string): Reference
  okJson<T>(res: Response, label: string): Promise<T>
  withDefaultUserAgent(fetchImpl: typeof fetch, ua: string): typeof fetch
  RefkitOptions.userAgent?: string | false   // default 'refkit-client/1'
  ReferenceProvider.search(query, ctx): Promise<EmittedReference[]>
  ```
- `runProviderSearch` parses each raw item with `parseEmitted`, completes it, and truncates the batch to `query.limit`.

- [ ] **Step 1: Write failing core tests**

Append to `packages/core/src/__tests__/reference.test.ts`:

```ts
import { completeReference, parseEmitted } from '../reference'

describe('EmittedReference → Reference', () => {
  const emitted = {
    modality: 'image', title: 'T', sourceUrl: 'https://X.test/a/', tags: ['t1'],
    rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://x.test/a' } },
    sourceScore: 12.5,
  }
  it('completeReference stamps id, source, canonicalUrl, verifiedAt and relevance', () => {
    const r = completeReference('p', parseEmitted(emitted), '2026-01-01T00:00:00.000Z')
    expect(r.id).toMatch(/^p:[0-9a-z]+$/)
    expect(r.source).toEqual({ providerId: 'p', sourceUrl: 'https://X.test/a/' })
    expect(r.canonicalUrl).toBe('https://X.test/a/')
    expect(r.verifiedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(r.relevance).toBe(0)
    expect(r.tags).toEqual(['t1'])
    expect(r.sourceScore).toBe(12.5)
    expect('sourceUrl' in r).toBe(false)
  })
  it('an explicit canonicalUrl is kept', () => {
    const r = completeReference('p', parseEmitted({ ...emitted, canonicalUrl: 'https://x.test/canon' }), '2026-01-01T00:00:00.000Z')
    expect(r.canonicalUrl).toBe('https://x.test/canon')
    expect(r.source.sourceUrl).toBe('https://X.test/a/')
  })
  it('parseEmitted rejects a missing sourceUrl', () => {
    expect(() => parseEmitted({ ...emitted, sourceUrl: undefined })).toThrow()
  })
})
```

Append to `packages/core/src/__tests__/provider-run.test.ts`:

```ts
it('completes emitted items and truncates to query.limit', async () => {
  const provider = defineProvider({
    id: 'p', modalities: ['image'],
    search: async () => Array.from({ length: 5 }, (_, i) => ({
      modality: 'image' as const, sourceUrl: `https://x.test/${i}`,
      rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed' as const, raw: { sourceTerms: 't', sourceUrl: 'u' } },
    })),
  })
  const run = await runProviderSearch(provider, { text: 'q', modalities: ['image'], limit: 3 }, { fetch: (async () => new Response('')) as typeof fetch, cacheTtlMs: 0, cacheRaw: true })
  expect(run.ok && run.valid.length).toBe(3)
  expect(run.ok && run.returned).toBe(5)
  expect(run.ok && run.valid[0].source.providerId).toBe('p')
  expect(run.ok && run.valid[0].id.startsWith('p:')).toBe(true)
})
```

Append to `packages/core/src/__tests__/resilience.test.ts`:

```ts
import { withDefaultUserAgent } from '../resilience'

it('withDefaultUserAgent adds a UA only when the request has none', async () => {
  const seen: string[] = []
  const inner = (async (_i: unknown, init?: RequestInit) => { seen.push(new Headers(init?.headers).get('user-agent') ?? '(none)'); return new Response('') }) as typeof fetch
  const f = withDefaultUserAgent(inner, 'refkit-client/1')
  await f('https://x.test/')
  await f('https://x.test/', { headers: { 'User-Agent': 'custom/2' } })
  expect(seen).toEqual(['refkit-client/1', 'custom/2'])
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @refkit/core test`
Expected: FAIL — `completeReference`, `parseEmitted`, `withDefaultUserAgent` missing.

- [ ] **Step 3: Rewrite `reference.ts`**

```ts
import { z } from 'zod'
import { MODALITIES, type Modality } from './modality'
import { rightsRecordSchema, type RightsRecord } from './rights'
import { referenceId } from './dedup-key'

export interface ReferenceMedia { url: string; width?: number; height?: number }
export interface MediaPreview { url: string; mediaType: string; width?: number; height?: number }
export interface VisualMeta { width: number; height: number; dominantColors?: string[] }
export interface TextMeta {
  excerpt: string
  excerptKind: 'passage' | 'structure' | 'quote'
  locator?: string
}

/** What a provider emits for one result: everything the SOURCE knows. Core stamps
 *  id, source, verifiedAt and relevance (see completeReference) — providers never
 *  write those, never post-truncate, and never compute ids. */
export interface EmittedReference {
  modality: Modality
  /** Fine-grained kind (open vocabulary, see ResourceKind), e.g. 'photo', 'texture'. */
  kind?: string
  title?: string
  /** Free-text description from the source (caption, medium, synopsis…). Feeds ranking. */
  description?: string
  /** Source tags / subjects / categories. Feeds ranking. */
  tags?: string[]
  /** Landing page at the source. Also the canonical URL unless canonicalUrl is set. */
  sourceUrl: string
  canonicalUrl?: string
  rights: RightsRecord
  thumbnail?: ReferenceMedia
  preview?: MediaPreview
  /** Computed by the satellite (pHash/blockhash); core only compares it. */
  perceptualHash?: string
  visual?: VisualMeta
  text?: TextMeta
  /** Upstream relevance score in the source's own scale; only the order within one
   *  source is meaningful. */
  sourceScore?: number
  raw?: unknown
}

export interface Reference extends Omit<EmittedReference, 'sourceUrl' | 'canonicalUrl'> {
  /** Content-addressed: `${providerId}:${hash(sourceUrl)}`; stable within a result set. */
  id: string
  source: { providerId: string; sourceUrl: string }
  canonicalUrl: string
  /** ISO; the moment the satellite's output was parsed. */
  verifiedAt: string
  /** 0..1, meaningful only after merge (RRF) or rerank; providers never set it. */
  relevance: number
}

const modalitySchema: z.ZodType<Modality> = z.enum(MODALITIES)
const mediaSchema = z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() })
const previewSchema = z.object({ url: z.string(), mediaType: z.string(), width: z.number().optional(), height: z.number().optional() })
const visualSchema = z.object({ width: z.number(), height: z.number(), dominantColors: z.array(z.string()).optional() })
const textSchema = z.object({ excerpt: z.string(), excerptKind: z.enum(['passage', 'structure', 'quote']), locator: z.string().optional() })

const emittedFields = {
  modality: modalitySchema,
  kind: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rights: rightsRecordSchema,
  thumbnail: mediaSchema.optional(),
  preview: previewSchema.optional(),
  perceptualHash: z.string().optional(),
  visual: visualSchema.optional(),
  text: textSchema.optional(),
  sourceScore: z.number().optional(),
  raw: z.unknown().optional(),
}

export const emittedReferenceSchema: z.ZodType<EmittedReference> = z.object({
  ...emittedFields,
  sourceUrl: z.string().min(1),
  canonicalUrl: z.string().min(1).optional(),
})

export const referenceSchema: z.ZodType<Reference> = z.object({
  ...emittedFields,
  id: z.string().min(1),
  source: z.object({ providerId: z.string().min(1), sourceUrl: z.string().min(1) }),
  canonicalUrl: z.string().min(1),
  verifiedAt: z.string().datetime(),
  relevance: z.number().min(0).max(1),
})

/** Validate a provider-emitted item at the core boundary. Throws on malformed input. */
export function parseEmitted(input: unknown): EmittedReference {
  return emittedReferenceSchema.parse(input)
}

/** Validate a complete reference (cache hits, host-supplied refs). */
export function parseReference(input: unknown): Reference {
  return referenceSchema.parse(input)
}

/** Stamp the fields that are core's concern onto an emitted item. */
export function completeReference(providerId: string, e: EmittedReference, now: string): Reference {
  const { sourceUrl, canonicalUrl, ...rest } = e
  return {
    ...rest,
    id: referenceId(providerId, sourceUrl),
    source: { providerId, sourceUrl },
    canonicalUrl: canonicalUrl ?? sourceUrl,
    verifiedAt: now,
    relevance: 0,
  }
}
```

- [ ] **Step 4: Core plumbing**

`provider.ts`: `search(query: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]>` (import the type).

`provider-run.ts`: import `{ completeReference, parseEmitted, parseReference }`; replace `parseItems` with two helpers and apply the limit:

```ts
  const parseCached = (raw: unknown[]): Reference[] => {
    const valid: Reference[] = []
    for (const item of raw) {
      try { valid.push(parseReference(item)) } catch (error) { deps.onError?.(error) }
    }
    return valid
  }
  const completeEmitted = (raw: unknown[]): Reference[] => {
    const now = new Date().toISOString()
    const valid: Reference[] = []
    for (const item of raw) {
      try { valid.push(completeReference(provider.id, parseEmitted(item), now)) } catch (error) { deps.onError?.(error) }
    }
    return valid
  }
  const truncate = (refs: Reference[]): Reference[] =>
    typeof query.limit === 'number' && query.limit > 0 ? refs.slice(0, query.limit) : refs
```
Cache-hit path: `const valid = truncate(parseCached(payload.refs))`. Live path: `const valid = truncate(completeEmitted(raw))`. Cache write stores `valid` (already completed). `returned: raw.length` unchanged.

`provider-helpers.ts` append:
```ts
/** Throw `${label} failed: ${status}` on a non-2xx response, else parse the JSON body. */
export async function okJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`)
  return (await res.json()) as T
}
```

`resilience.ts` append:
```ts
/** Add a User-Agent to requests that carry none (Node's default UA is rejected by
 *  some source edges). Browsers ignore the header silently. */
export function withDefaultUserAgent(fetchImpl: typeof fetch, ua: string): typeof fetch {
  const wrapped = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const fromRequest = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined
    const headers = new Headers(init?.headers ?? fromRequest)
    if (!headers.has('user-agent')) headers.set('user-agent', ua)
    return fetchImpl(input, { ...init, headers })
  }
  return wrapped as typeof fetch
}
```

`client.ts`: `RefkitOptions.userAgent?: string | false` with doc "Default 'refkit-client/1'; false disables"; `const DEFAULT_USER_AGENT = 'refkit-client/1'`; when building `sharedFetch`, wrap: `const withRetry = …; const sharedFetch = options.userAgent === false ? withRetry : withDefaultUserAgent(withRetry, options.userAgent ?? DEFAULT_USER_AGENT)`.

`index.ts`: export `EmittedReference` type, `emittedReferenceSchema`, `parseEmitted`, `completeReference`, `okJson`, `withDefaultUserAgent`.

- [ ] **Step 5: Testkit**

In `packages/provider-testkit/src/index.ts` replace the body of `searchConformant` after the `provider.search` call:

```ts
  const raw = await provider.search(query, ctx)
  const enforceImages = opts.enforceImageUrls ?? provider.modalities.includes('image')
  const now = new Date().toISOString()
  return raw.map((item, i) => {
    let ref: Reference
    try {
      ref = completeReference(provider.id, parseEmitted(item), now)
    } catch (e) {
      throw new Error(`[${provider.id}] result #${i} failed emittedReferenceSchema: ${(e as Error).message}`)
    }
    if (provider.kinds && provider.kinds.length > 0 && ref.kind !== undefined && !provider.kinds.includes(ref.kind)) {
      throw new Error(`[${provider.id}] result #${i} kind "${ref.kind}" is not in the provider's declared kinds [${provider.kinds.join(', ')}]`)
    }
    if (enforceImages) {
      // … keep the two D8 checks exactly as they are today …
    }
    return ref
  })
```
Delete the `VERSIONED` constant, the id-prefix check, the `source.providerId` check and the licenseVersion check. Update imports (`completeReference`, `parseEmitted`, drop `parseReference`, `CC_VERSIONED_FAMILIES`, `LicenseId` if unused). Update `packages/provider-testkit/src/__tests__/testkit.test.ts` accordingly (fake providers now emit `sourceUrl`, no `id`/`source`).

- [ ] **Step 6: Migrate every provider package (mechanical)**

Apply to each `packages/provider-*/src/index.ts` (artic, brave, europeana, flickr, freesound, gutendex, internet-archive, jamendo, met, nailbook, openverse, pexels, pixabay, poetrydb, polyhaven, rijksmuseum, smithsonian, unsplash, wikimedia-commons — every factory in the file, including the audio/video/second factories):

1. Import `type EmittedReference` instead of `type Reference`; import `okJson`; drop `referenceId` from the import.
2. In each `toReference`: return type `EmittedReference` (or `EmittedReference | null`); delete the `id:`, `source:`, `verifiedAt:`, `relevance: 0` lines; rename `canonicalUrl: X` to `sourceUrl: X` (every current provider uses the same URL for both; if you find one where `canonicalUrl` and `source.sourceUrl` differ, keep `sourceUrl` = the old `source.sourceUrl` and add `canonicalUrl` = the old `canonicalUrl`).
3. Replace each `if (!res.ok) throw new Error(\`<label> failed: ${res.status}\`)` + `const json = (await res.json()) as T` pair with `const json = await okJson<T>(res, '<label>')` (same label text). Leave `ok` checks that do something other than throw (e.g. `if (!r.ok) return null` inside N+1 loops).
4. Delete post-hoc truncation such as `.slice(0, q.limit)` / `q.limit > 0 ? refs.slice(…) : refs` at the end of `search`. Keep uses of `q.limit` that size the upstream request (`per_page`, `rows`, `maxObjects`, page windows).
5. Where the upstream item type ALREADY declares an array of tags/subjects/categories (pixabay `tags` is a comma-separated string → `tags: h.tags.split(',').map(s => s.trim()).filter(Boolean)`; freesound `tags`; nailbook `tags.map(t => t.name)`; polyhaven `[...(asset.categories ?? []), ...(asset.tags ?? [])]`; gutendex `subjects` if present in its interface), map it to `tags`. Do not add new upstream fields in this task.
6. Return type of `search`: `Promise<EmittedReference[]>`.

Worked example — `packages/provider-unsplash/src/index.ts` after migration:

```ts
import {
  defineProvider, okJson,
  setIfString, setIfPositiveInt,
  type EmittedReference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'
// … config/options/result interfaces unchanged …
function toReference(r: UnsplashResult): EmittedReference {
  const rights: RightsRecord = {
    license: 'unsplash',
    author: r.user.name,
    rehostPolicy: 'hotlink-required',
    raw: { sourceTerms: 'https://unsplash.com/license', sourceUrl: r.links.html },
  }
  return {
    modality: 'image',
    kind: 'photo',
    title: r.description ?? r.alt_description ?? undefined,
    sourceUrl: r.links.html,
    rights,
    thumbnail: { url: r.urls.thumb },
    visual: { width: r.width, height: r.height, dominantColors: r.color ? [r.color] : undefined },
    raw: r, // carries links.download_location — host fires it on use (Unsplash ToS)
  }
}
export function unsplash(config: UnsplashConfig) {
  return defineProvider({
    id: 'unsplash', modalities: ['image'], kinds: ['photo'],
    description: 'High-quality free stock photography (Unsplash)',
    capabilities: { controls: ['orientation', 'color', 'language', 'sort', 'safety', 'page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
      // … URL building unchanged …
      const res = await ctx.fetch(url.toString(), { headers: { Authorization: `Client-ID ${config.accessKey}`, 'Accept-Version': 'v1' }, signal: ctx.signal })
      const json = await okJson<UnsplashResponse>(res, 'unsplash search')
      return json.results.map(toReference)
    },
  })
}
```

Provider tests: assertions on `r.canonicalUrl` become `r.sourceUrl`; delete assertions on `r.id`, `r.source`, `r.verifiedAt`, `r.relevance`; tests that asserted a provider truncates to `limit` are deleted (core owns it now). Fake providers in `packages/core/src/__tests__/*.test.ts`, `packages/mcp/src/__tests__/mcp.test.ts` and `packages/provider-testkit/src/__tests__/testkit.test.ts` must emit `{ modality, sourceUrl, rights, … }` (no `id`, `source`, `verifiedAt`, `relevance`).

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test:run` — green. Confirm with:
`grep -rn "relevance: 0\|verifiedAt\|referenceId(" packages/provider-*/src --include='*.ts' | grep -v __tests__` → no output.
`grep -rn "if (!res.ok) throw" packages/provider-*/src --include='*.ts' | grep -v __tests__` → no output.

- [ ] **Step 8: Commit**

```bash
git add -A packages
git commit -m "refactor: providers emit EmittedReference; core completes provenance, relevance and limit"
```

---

### Task 5: Descriptive fields and upstream scores in Met, Art Institute, Wikimedia Commons, Rijksmuseum

**Files:**
- Modify: `packages/provider-met/src/index.ts` + `src/__tests__/met.test.ts`
- Modify: `packages/provider-artic/src/index.ts` + `src/__tests__/artic.test.ts`
- Modify: `packages/provider-wikimedia-commons/src/index.ts` + its test
- Modify: `packages/provider-rijksmuseum/src/index.ts` + its test

**Interfaces:**
- Consumes: `EmittedReference.description`, `.tags`, `.sourceScore` from Task 4.

- [ ] **Step 1: Write failing provider tests**

Add one case per provider, extending the existing fixture objects:

met.test.ts — add `objectName: 'Painting', medium: 'Oil on canvas', culture: 'Dutch', period: '17th century', classification: 'Paintings', tags: [{ term: 'Lions' }, { term: 'Hunting' }]` to the fixture object and assert:
```ts
expect(r.description).toBe('Painting. Oil on canvas. Dutch. 17th century')
expect(r.tags).toEqual(['Paintings', 'Lions', 'Hunting'])
```
artic.test.ts — add `_score: 87.05, short_description: '<p>A <em>lion</em> at rest.</p>', medium_display: 'Bronze', classification_titles: ['sculpture'], subject_titles: ['animals', 'lions'], term_titles: ['bronze', 'animals']` and assert:
```ts
expect(r.description).toBe('A lion at rest.')
expect(r.tags).toEqual(['sculpture', 'animals', 'lions', 'bronze'])
expect(r.sourceScore).toBe(87.05)
```
plus assert the request URL's `fields` param contains `short_description`, `medium_display`, `classification_titles`, `subject_titles`, `term_titles`.

wikimedia test — add to the fixture's `extmetadata`: `ImageDescription: { value: '<a href="x">Forest</a> path in <b>spring</b>' }, Categories: { value: 'Forests|Paths|Spring' }` and assert `r.description === 'Forest path in spring'`, `r.tags` equals `['Forests', 'Paths', 'Spring']`.

rijksmuseum test — add to the fixture EDM record's `aggregatedCHO` a `description` in the same localized shape the fixture already uses for `title` (e.g. `description: { en: ['A sunken road through a pine forest'] }`) and assert `r.description === 'A sunken road through a pine forest'`. If the fixture's `title` is a plain string, use a plain string for `description` too — `firstLocalized` handles both.

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @refkit/provider-met --filter @refkit/provider-artic --filter @refkit/provider-wikimedia-commons --filter @refkit/provider-rijksmuseum test`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

Met — extend `MetObject` with `objectName: string; medium: string; culture?: string; period?: string; classification?: string; tags?: Array<{ term: string }> | null` and in `toReference`:
```ts
    description: [o.objectName, o.medium, o.culture, o.period].filter(Boolean).join('. ') || undefined,
    tags: [o.classification, ...(o.tags ?? []).map(t => t.term)].filter((t): t is string => !!t),
```
(emit `tags` only when non-empty: `...(tags.length ? { tags } : {})`).

Artic — extend `ArticArtwork` with `_score?: number; short_description?: string | null; medium_display?: string | null; classification_titles?: string[]; subject_titles?: string[]; term_titles?: string[]`; add `'short_description', 'medium_display', 'classification_titles', 'subject_titles', 'term_titles'` to the default field set in `articFields`; add
```ts
const stripHtml = (s: string | null | undefined): string | undefined => {
  const t = (s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return t || undefined
}
```
and in `toReference`: `description: stripHtml(a.short_description) ?? (a.medium_display || undefined)`, `tags: [...new Set([...(a.classification_titles ?? []), ...(a.subject_titles ?? []), ...(a.term_titles ?? [])])]` (only when non-empty), `sourceScore: a._score` (only when a finite number).

Wikimedia — in `toReference`:
```ts
  const description = stripTags(emVal(info.extmetadata, 'ImageDescription'))
  const categories = (emVal(info.extmetadata, 'Categories') ?? '').split('|').map(s => s.trim()).filter(Boolean)
```
emit `description: description ? description.slice(0, 500) : undefined` and `tags` when non-empty.

Rijksmuseum — `EdmAggregatedCho` gains `description?: unknown`; emit `description: firstLocalized(rec.aggregatedCHO?.description, ['en', 'nl'])`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:run` — green.

```bash
git add -A packages/provider-met packages/provider-artic packages/provider-wikimedia-commons packages/provider-rijksmuseum
git commit -m "feat(providers): descriptive fields and upstream scores for Met, Artic, Wikimedia, Rijksmuseum"
```

---

### Task 6: Orchestrator stages, multi-pass fidelity, deadline and gate context

**Files:**
- Create: `packages/core/src/select.ts`, `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/client.ts`, `packages/core/src/schemas.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/select.test.ts` (new), `client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // select.ts
  export const PROVIDER_SKIP_REASONS = ['unsupported-modality', 'not-selected', 'unsupported-kind'] as const
  export type ProviderSkipReason
  export interface ProviderSelection { chosen: ReferenceProvider[]; skipReasons: Map<string, ProviderSkipReason>; unknownSources: string[] }
  export function selectProviders(providers: readonly ReferenceProvider[], input: { modalities: Modality[]; sources?: readonly string[]; kind?: string; text: string }): ProviderSelection
  // pipeline.ts
  export interface PassDeps { providers: readonly ReferenceProvider[]; chosen: readonly ReferenceProvider[]; skipReasons: Map<string, ProviderSkipReason>; query: string; modalities: Modality[]; controls?: SearchControls; providerOptions?: ProviderOptionsById; fetchLimit: number; run: ProviderRunDeps; concurrency?: number; merge?: MergeOptions; rerank?: Reranker; gateFor?: Intent; gateContext?: { userJurisdiction?: string }; seen?: Set<number> }
  export interface PassOutcome { refs: Reference[]; controlsMeta?: SearchControlsMeta; statusByProvider: Map<string, ProviderSearchStatus>; gate?: SearchGateMeta; rightsConflicts: RightsConflict[]; totalReturned: number }
  export function runPass(deps: PassDeps, page: number | undefined): Promise<PassOutcome>
  // client.ts additions
  SearchInput.deadlineMs?: number; SearchInput.gateContext?: { userJurisdiction?: string }; SearchMeta.passes: number
  ```
- `PROVIDER_SKIP_REASONS` moves from client.ts to select.ts (client re-exports nothing; index exports from select).

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/__tests__/select.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defineProvider } from '../provider'
import { selectProviders } from '../select'

const p = (id: string, modalities: Array<'image' | 'text'>, kinds?: string[]) =>
  defineProvider({ id, modalities, ...(kinds ? { kinds } : {}), search: async () => [] })

describe('selectProviders', () => {
  const providers = [p('a', ['image'], ['photo']), p('b', ['image']), p('c', ['text'])]
  it('keeps modality matches and explains every exclusion', () => {
    const s = selectProviders(providers, { modalities: ['image'], text: 'x' })
    expect(s.chosen.map(x => x.id)).toEqual(['a', 'b'])
    expect(s.skipReasons.get('c')).toBe('unsupported-modality')
  })
  it('applies the sources whitelist and reports unknown ids', () => {
    const s = selectProviders(providers, { modalities: ['image'], sources: ['b', 'zzz'], text: 'x' })
    expect(s.chosen.map(x => x.id)).toEqual(['b'])
    expect(s.skipReasons.get('a')).toBe('not-selected')
    expect(s.unknownSources).toEqual(['zzz'])
  })
  it('kind narrowing skips declared mismatches and keeps undeclared providers', () => {
    const s = selectProviders(providers, { modalities: ['image'], kind: 'texture', text: 'x' })
    expect(s.chosen.map(x => x.id)).toEqual(['b'])
    expect(s.skipReasons.get('a')).toBe('unsupported-kind')
  })
  it('throws when nothing matches', () => {
    expect(() => selectProviders(providers, { modalities: ['image'], sources: ['zzz'], text: 'x' })).toThrow(/no configured provider matches source id/)
    expect(() => selectProviders(providers, { modalities: ['video'], text: 'x' })).toThrow(/no registered provider supports/)
  })
})
```

Add to `client.test.ts` (use the file's existing fake-provider helpers; they emit `{ modality, sourceUrl, rights }`):

```ts
it('cursor advance accumulates pass diagnostics instead of overwriting them', async () => {
  // provider `flaky` fails on page 1 and succeeds on page 2; `steady` returns the same
  // single item on every page so page 1's pool is exhausted after the first call.
  let calls = 0
  const flaky = defineProvider({ id: 'flaky', modalities: ['image'], capabilities: { controls: ['page'] }, search: async (q) => {
    calls++
    if ((q.controls?.page ?? 1) === 1) throw new Error('boom')
    return [emit('https://f.test/2')]
  } })
  const steady = defineProvider({ id: 'steady', modalities: ['image'], capabilities: { controls: ['page'] }, search: async () => [emit('https://s.test/1')] })
  const refkit = createRefkit({ providers: [flaky, steady], resilience: false })
  const first = await refkit.searchWithMeta({ query: 'q', modalities: ['image'], limit: 5 })
  const second = await refkit.searchWithMeta({ query: 'q', modalities: ['image'], limit: 5, cursor: first.meta.nextCursor })
  expect(second.meta.passes).toBeGreaterThan(1)
  expect(second.meta.warnings.some(w => /pass 1: 1 provider\(s\) failed/.test(w))).toBe(true)
  expect(second.references.map(r => r.canonicalUrl)).toEqual(['https://f.test/2'])
  expect(calls).toBeGreaterThan(1)
})

it('deadlineMs bounds the whole search and reports hung providers as failed', async () => {
  const hung = defineProvider({ id: 'hung', modalities: ['image'], search: (_q, ctx) => new Promise((_, reject) => ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason))) })
  const fast = defineProvider({ id: 'fast', modalities: ['image'], search: async () => [emit('https://x.test/1')] })
  const refkit = createRefkit({ providers: [hung, fast], resilience: false })
  const started = Date.now()
  const { references, meta } = await refkit.searchWithMeta({ query: 'q', modalities: ['image'], deadlineMs: 100 })
  expect(Date.now() - started).toBeLessThan(2000)
  expect(references).toHaveLength(1)
  expect(meta.providers.find(p => p.providerId === 'hung')?.status).toBe('failed')
})

it('gateContext forwards the user jurisdiction to the search-time gate', async () => {
  const us = defineProvider({ id: 'us', modalities: ['image'], search: async () => [{ ...emit('https://x.test/us'), rights: { license: 'PD', jurisdiction: 'US', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } } }] })
  const refkit = createRefkit({ providers: [us], resilience: false })
  const open = await refkit.search({ query: 'q', modalities: ['image'], gateFor: 'commercial-product' })
  const gated = await refkit.search({ query: 'q', modalities: ['image'], gateFor: 'commercial-product', gateContext: { userJurisdiction: 'DE' } })
  expect(open).toHaveLength(1)
  expect(gated).toHaveLength(0)
})
```
(`emit(url)` is a tiny local helper returning `{ modality: 'image', sourceUrl: url, rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } } }`; add it if the file lacks an equivalent.)

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @refkit/core test`
Expected: FAIL — `../select` missing; `passes`, `deadlineMs`, `gateContext` unknown.

- [ ] **Step 3: Create `select.ts`**

```ts
import type { Modality } from './modality'
import type { ReferenceProvider } from './provider'

export const PROVIDER_SKIP_REASONS = ['unsupported-modality', 'not-selected', 'unsupported-kind'] as const
export type ProviderSkipReason = (typeof PROVIDER_SKIP_REASONS)[number]

export interface ProviderSelection {
  chosen: ReferenceProvider[]
  /** Why each excluded provider sat this search out. */
  skipReasons: Map<string, ProviderSkipReason>
  /** `sources` ids that match no configured provider (tolerated, surfaced as a warning). */
  unknownSources: string[]
}

export interface SelectionInput {
  modalities: Modality[]
  sources?: readonly string[]
  /** `controls.media.kind` — narrows to providers that declare it (undeclared are kept). */
  kind?: string
  text: string
}

/** Decide which providers a search fans out to, with an explanation per exclusion.
 *  Throws when nothing is left: a source-scoped miss is a caller typo and must fail
 *  loudly rather than read as "no results". */
export function selectProviders(providers: readonly ReferenceProvider[], input: SelectionInput): ProviderSelection {
  const skipReasons = new Map<string, ProviderSkipReason>()
  const reasonFor = (p: ReferenceProvider): ProviderSkipReason | undefined => {
    if (!p.modalities.some(m => input.modalities.includes(m))) return 'unsupported-modality'
    if (input.sources != null && !input.sources.includes(p.id)) return 'not-selected'
    if (input.kind !== undefined && p.kinds && !p.kinds.includes(input.kind)) return 'unsupported-kind'
    return undefined
  }
  for (const p of providers) {
    const reason = reasonFor(p)
    if (reason) skipReasons.set(p.id, reason)
  }
  const chosen = providers.filter(p => !skipReasons.has(p.id))
  if (chosen.length === 0) {
    const kindSuffix = input.kind !== undefined ? ` with kind "${input.kind}"` : ''
    if (input.sources != null) {
      throw new Error(`refkit.search: no configured provider matches source id(s) [${input.sources.join(', ')}] for modalities [${input.modalities.join(', ')}]${kindSuffix}`)
    }
    throw new Error(`refkit.search: no registered provider supports modalities [${input.modalities.join(', ')}]${kindSuffix}`)
  }
  const unknownSources = input.sources ? input.sources.filter(id => !providers.some(p => p.id === id)) : []
  return { chosen, skipReasons, unknownSources }
}
```

- [ ] **Step 4: Create `pipeline.ts`**

Move the body of today's `runPass` closure out of `client.ts` into named stages:

```ts
import type { Reference } from './reference'
import type { Reranker } from './rerank'
import type { Modality } from './modality'
import type { Intent } from './evaluate-use'
import { evaluateUse } from './evaluate-use'
import type { ReferenceProvider, ProviderOptionsById } from './provider'
import type { SearchControls } from './controls'
import { mergeReferences, type MergeOptions, type RightsConflict } from './merge'
import { normalizeQuery, requestedControlKeys, supportedControlKeys, unsupportedControlKeys } from './query'
import { runProviderSearch, type ProviderRun, type ProviderRunDeps } from './provider-run'
import { cursorSeenKey } from './cursor'
import type { ProviderSkipReason } from './select'
import type { ProviderSearchStatus, SearchControlsMeta, SearchGateMeta } from './client'

export interface PassDeps {
  providers: readonly ReferenceProvider[]
  chosen: readonly ReferenceProvider[]
  skipReasons: Map<string, ProviderSkipReason>
  query: string
  modalities: Modality[]
  controls?: SearchControls
  providerOptions?: ProviderOptionsById
  fetchLimit: number
  run: ProviderRunDeps
  concurrency?: number
  merge?: MergeOptions
  rerank?: Reranker
  gateFor?: Intent
  gateContext?: { userJurisdiction?: string }
  seen?: Set<number>
  signal?: AbortSignal
  onProviderError?: (providerId: string, error: unknown) => void
}

export interface PassOutcome {
  refs: Reference[]
  controlsMeta?: SearchControlsMeta
  statusByProvider: Map<string, ProviderSearchStatus>
  gate?: SearchGateMeta
  rightsConflicts: RightsConflict[]
  totalReturned: number
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

// Bounded-parallel map: at most `limit` fn calls in flight, results in input order.
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export function controlsMetaFor(providers: readonly ReferenceProvider[], controls: SearchControls | undefined): SearchControlsMeta | undefined {
  const requested = requestedControlKeys(controls ?? {})
  if (requested.length === 0) return undefined
  return {
    requested,
    appliedByProvider: Object.fromEntries(providers.map(p => [p.id, supportedControlKeys(p, controls ?? {})])),
    ignoredByProvider: Object.fromEntries(providers.map(p => [p.id, unsupportedControlKeys(p, controls ?? {})])),
  }
}

export async function fanOut(deps: PassDeps, controls: SearchControls | undefined): Promise<ProviderRun[]> {
  const runProvider = (p: ReferenceProvider) => {
    const query = normalizeQuery({ query: deps.query, modalities: deps.modalities, controls, providerOptions: deps.providerOptions, limit: deps.fetchLimit }, p)
    return runProviderSearch(p, query, { ...deps.run, onError: error => deps.onProviderError?.(p.id, error) })
  }
  return deps.concurrency ? mapBounded(deps.chosen, deps.concurrency, runProvider) : Promise.all(deps.chosen.map(runProvider))
}

export function collectStatuses(deps: PassDeps, runs: readonly ProviderRun[]): { statusByProvider: Map<string, ProviderSearchStatus>; perSource: Reference[][]; totalReturned: number } {
  const statusByProvider = new Map<string, ProviderSearchStatus>()
  for (const p of deps.providers) {
    const reason = deps.skipReasons.get(p.id)
    if (reason) statusByProvider.set(p.id, { providerId: p.id, status: 'skipped', reason })
  }
  const perSource: Reference[][] = []
  let totalReturned = 0
  runs.forEach((run, i) => {
    const provider = deps.chosen[i]
    if (run.ok) {
      totalReturned += run.returned
      statusByProvider.set(provider.id, {
        providerId: provider.id, status: 'fulfilled', returned: run.returned, accepted: run.valid.length,
        rejected: run.returned - run.valid.length, latencyMs: run.latencyMs, ...(run.cached ? { cached: true } : {}),
      })
      perSource.push(run.valid)
    } else {
      statusByProvider.set(provider.id, { providerId: provider.id, status: 'failed', error: errorSummary(run.error), latencyMs: run.latencyMs })
    }
  })
  return { statusByProvider, perSource, totalReturned }
}

export function applyGate(refs: Reference[], intent: Intent | undefined, ctx?: { userJurisdiction?: string }): { refs: Reference[]; gate?: SearchGateMeta } {
  if (!intent) return { refs }
  const before = refs.length
  const kept = refs.filter(r => evaluateUse(r.rights, intent, ctx).decision.startsWith('allowed'))
  return { refs: kept, gate: { intent, before, after: kept.length, dropped: before - kept.length } }
}

export function filterSeen(refs: Reference[], seen: Set<number> | undefined): Reference[] {
  return seen ? refs.filter(r => !seen.has(cursorSeenKey(r.canonicalUrl))) : refs
}

/** One full fan-out → merge → rerank → gate → seen-filter pass at a provider-local page. */
export async function runPass(deps: PassDeps, page: number | undefined): Promise<PassOutcome> {
  const controls = page !== undefined ? { ...deps.controls, page } : deps.controls
  const controlsMeta = controlsMetaFor(deps.providers, controls)
  const runs = await fanOut(deps, controls)
  const { statusByProvider, perSource, totalReturned } = collectStatuses(deps, runs)
  if (deps.chosen.length > 0 && !runs.some(r => r.ok)) {
    throw new AggregateError(runs.filter(r => !r.ok).map(r => (r as { error: unknown }).error), 'refkit.search: all providers failed')
  }
  const rightsConflicts: RightsConflict[] = []
  let refs = mergeReferences(perSource, {
    ...deps.merge,
    onRightsConflict: c => { rightsConflicts.push(c); deps.merge?.onRightsConflict?.(c) },
  })
  if (deps.rerank) refs = await deps.rerank({ query: deps.query, refs, signal: deps.signal })
  const gated = applyGate(refs, deps.gateFor, deps.gateContext)
  refs = filterSeen(gated.refs, deps.seen)
  return { refs, controlsMeta, statusByProvider, gate: gated.gate, rightsConflicts, totalReturned }
}
```

- [ ] **Step 5: Slim `client.ts`**

Delete `mapBounded`, `errorSummary`, the inline `skipReasonFor`/`chosen` block, the inline `runPass`, and the `PassOutcome` interface (now imported). Keep the interfaces (`RefkitOptions`, `SearchInput`, `SearchMeta`, …) with these additions:

```ts
// SearchInput
  /** Whole-search deadline in ms, composed with `signal`. Providers still in flight
   *  when it fires are reported as failed; the search returns everyone else. */
  deadlineMs?: number
  /** Context for the search-time gate (`gateFor`), matching evaluateUse's ctx. */
  gateContext?: { userJurisdiction?: string }
// SearchMeta
  /** Fan-out passes this call ran (>1 only when the cursor advanced pages). */
  passes: number
```
`ProviderSearchStatus.reason?: ProviderSkipReason` imports from `./select`. `searchInternal` becomes:

```ts
  async function searchInternal(input: SearchInput): Promise<SearchResult> {
    const doFetch = options.fetch ?? globalThis.fetch
    if (typeof doFetch !== 'function') throw new Error('createRefkit: no fetch available — pass options.fetch')
    const selection = selectProviders(options.providers, { modalities: input.modalities, sources: input.sources, kind: input.controls?.media?.kind, text: input.query })
    const limit = input.limit ?? DEFAULT_LIMIT
    const poolFactor = Math.max(1, Number.isFinite(input.poolFactor) ? (input.poolFactor as number) : DEFAULT_POOL_FACTOR)
    const fetchLimit = Math.max(limit, Math.min(Math.ceil(limit * poolFactor), MAX_POOL_LIMIT))
    const cursorState = input.cursor !== undefined ? decodeCursor(input.cursor) : undefined
    const seen = cursorState ? new Set(cursorState.seen) : undefined
    const resilience = options.resilience === false ? undefined : { timeoutMs: options.resilience?.timeoutMs ?? DEFAULT_TIMEOUT_MS, retries: options.resilience?.retries ?? DEFAULT_RETRIES }
    const withRetry = resilience && resilience.retries > 0 ? retryingFetch(doFetch, { retries: resilience.retries }) : doFetch
    const sharedFetch = options.userAgent === false ? withRetry : withDefaultUserAgent(withRetry, options.userAgent ?? DEFAULT_USER_AGENT)
    const parentSignal = input.signal ?? options.signal
    const deadline = input.deadlineMs !== undefined ? withTimeout(parentSignal, input.deadlineMs) : undefined
    const signal = deadline?.signal ?? parentSignal
    const concurrency = options.concurrency !== undefined && options.concurrency >= 1 ? Math.floor(options.concurrency) : undefined
    const deps: PassDeps = {
      providers: options.providers, chosen: selection.chosen, skipReasons: selection.skipReasons,
      query: input.query, modalities: input.modalities, controls: input.controls, providerOptions: input.providerOptions, fetchLimit,
      run: { fetch: sharedFetch, cache: options.cache, cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, cacheRaw: options.cacheRaw ?? true, timeoutMs: resilience?.timeoutMs, signal },
      concurrency, merge: options.merge, rerank: input.rerank, gateFor: input.gateFor, gateContext: input.gateContext, seen, signal,
      onProviderError: (providerId, error) => input.onProviderError?.({ providerId, error }),
    }
    try {
      let page = cursorState ? cursorState.page : input.controls?.page
      const passes: PassOutcome[] = [await runPass(deps, page)]
      if (cursorState) {
        for (let advances = 0; passes[passes.length - 1].refs.length === 0 && passes[passes.length - 1].totalReturned > 0 && advances < MAX_CURSOR_ADVANCES; advances++) {
          page = (page ?? 1) + 1
          passes.push(await runPass(deps, page))
        }
      }
      const last = passes[passes.length - 1]
      const references = last.refs.slice(0, limit)
      // … nextCursor exactly as today (uses `page`, `cursorState`, `references`) …
      const warnings: string[] = []
      if (selection.unknownSources.length > 0) warnings.push(`unknown source id(s) ignored: ${selection.unknownSources.join(', ')}.`)
      passes.forEach((pass, i) => {
        const failed = [...pass.statusByProvider.values()].filter(s => s.status === 'failed').length
        if (failed > 0) warnings.push(passes.length > 1 ? `pass ${i + 1}: ${failed} provider(s) failed; returning partial results.` : `${failed} provider(s) failed; returning partial results.`)
      })
      const seenConflicts = new Set<string>()
      for (const pass of passes) for (const c of pass.rightsConflicts) {
        if (seenConflicts.has(c.canonicalUrl)) continue
        seenConflicts.add(c.canonicalUrl)
        warnings.push(`cross-source license conflict for ${c.canonicalUrl}: ${c.licenses.join(' vs ')} → resolved to ${c.resolvedLicense}.`)
      }
      if (last.gate && last.gate.dropped > 0) warnings.push(`${last.gate.dropped} result(s) dropped by ${last.gate.intent} gate.`)
      // provider statuses: last pass wins, latency summed over passes
      const providers = options.providers.map(p => {
        const status = last.statusByProvider.get(p.id) ?? { providerId: p.id, status: 'skipped' as const, reason: selection.skipReasons.get(p.id) ?? 'unsupported-modality' as const }
        const latencyMs = passes.reduce((sum, pass) => sum + (pass.statusByProvider.get(p.id)?.latencyMs ?? 0), 0)
        return status.status === 'skipped' ? status : { ...status, latencyMs }
      })
      return { references, meta: { query: input.query, modalities: input.modalities, limit, poolFactor, fetchLimit, passes: passes.length, ...(last.controlsMeta ? { controls: last.controlsMeta } : {}), ...(input.providerOptions ? { providerOptions: Object.keys(input.providerOptions) } : {}), providers, ...(last.gate ? { gate: last.gate } : {}), ...(nextCursor ? { nextCursor } : {}), warnings } }
    } finally {
      deadline?.cancel()
    }
  }
```
(`withTimeout` is already exported by `resilience.ts`.) `schemas.ts`: add `passes: z.number()` and import `PROVIDER_SKIP_REASONS` from `./select`. `index.ts`: export `selectProviders`, `PROVIDER_SKIP_REASONS`, `ProviderSkipReason`, `ProviderSelection` from `./select`; export `runPass` and the `PassDeps`/`PassOutcome` types from `./pipeline`.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:run` — green. `wc -l packages/core/src/client.ts` should be well under 300.

```bash
git add -A packages/core
git commit -m "refactor(core): selection and pipeline stages; multi-pass diagnostics, deadlineMs, gateContext"
```

---

### Task 7: Accuracy defaults — source confidence, default reranker, richer lexical scoring, threshold

**Files:**
- Modify: `packages/core/src/merge.ts`, `rerank.ts`, `pipeline.ts`, `client.ts`, `schemas.ts`, `index.ts`
- Test: `merge.test.ts`, `rerank.test.ts`, `client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  MergeOptions.weights?: readonly number[]               // parallel to perSource; multiplies each list's RRF contribution
  refText(ref): string; lexicalHit(queryTokens, ref): boolean
  sourceConfidence(queryTokens: readonly string[], refs: readonly Reference[], floor = 0.1): number
  LexicalRerankOptions.nearDuplicatePenalty?: number      // default 0.25
  LexicalRerankOptions.nearDuplicateThreshold?: number    // default 0.7 (title-token Jaccard)
  LexicalRerankOptions.sourceScoreWeight?: number         // default 0
  RefkitOptions.sourceConfidence?: boolean | { floor?: number }   // default true
  RefkitOptions.rerank?: Reranker | false                 // default lexicalReranker()
  SearchInput.rerank?: Reranker | false                   // per-call override
  SearchInput.minRelevance?: number
  SearchMeta.threshold?: { minRelevance: number; dropped: number }
  ProviderSearchStatus.confidence?: number
  ```

- [ ] **Step 1: Write failing tests**

merge.test.ts:
```ts
it('weights scale a source\'s RRF contribution', () => {
  const a = ref('a', 'https://x.test/a'); const b = ref('b', 'https://x.test/b')
  const unweighted = mergeReferences([[a], [b]])
  expect(unweighted[0].relevance).toBe(1); expect(unweighted[1].relevance).toBe(1)
  const weighted = mergeReferences([[a], [b]], { weights: [1, 0.1] })
  expect(weighted[0].canonicalUrl).toBe('https://x.test/a')
  expect(weighted[1].relevance).toBeCloseTo(0.1, 5)
})
```
(`ref(providerId, url)` — the file's existing fixture helper or an equivalent producing a complete `Reference`.)

rerank.test.ts:
```ts
it('scores description and tags, not just the title', () => {
  const plain = mk('a', { title: 'Untitled' })
  const tagged = mk('b', { title: 'Untitled', tags: ['forest', 'path'] })
  const described = mk('c', { title: 'Untitled', description: 'A path through a forest' })
  const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0, nearDuplicatePenalty: 0 })({ query: 'forest path', refs: [plain, tagged, described] }) as Reference[]
  expect(out.map(r => r.id).slice(0, 2).sort()).toEqual(['b', 'c'])
  expect(out[2].id).toBe('a')
})
it('penalises same-source near-duplicate titles so they do not cluster', () => {
  const dupes = ['Forest path near Graigddu-isaf 1', 'Forest path near Graigddu-isaf 2', 'Forest path near Graigddu-isaf 3'].map((t, i) => mk(`d${i}`, { title: t, providerId: 'wiki' }))
  const other = mk('o', { title: 'Forest path in Finland', providerId: 'wiki' })
  const out = lexicalReranker({ qualityWeight: 0, sourceDiversity: 0 })({ query: 'forest path', refs: [...dupes, other] }) as Reference[]
  expect(out[1].id).toBe('o')
})
it('sourceConfidence floors at 0.1 and rises with the hit rate', () => {
  const q = tokenize('lion')
  expect(sourceConfidence(q, [mk('a', { title: 'Nail art' }), mk('b', { title: 'Gel nails' })])).toBeCloseTo(0.1, 5)
  expect(sourceConfidence(q, [mk('a', { title: 'Lion head' }), mk('b', { title: 'Gel nails' })])).toBeCloseTo(0.55, 5)
  expect(sourceConfidence(q, [])).toBe(1)
})
```
(`mk(id, { title, description?, tags?, providerId? })` builds a complete `Reference`; add it to the test file if missing.)

client.test.ts:
```ts
it('a source whose batch never mentions the query sinks below a source that does', async () => {
  const noise = defineProvider({ id: 'noise', modalities: ['image'], search: async () => ['お客様ネイル', '親指', 'ネイル'].map((t, i) => ({ ...emit(`https://n.test/${i}`), title: t })) })
  const signal = defineProvider({ id: 'signal', modalities: ['image'], search: async () => [{ ...emit('https://s.test/1'), title: 'A lion' }] })
  const refkit = createRefkit({ providers: [noise, signal], resilience: false, rerank: false })
  const { references, meta } = await refkit.searchWithMeta({ query: 'lion', modalities: ['image'] })
  expect(references[0].source.providerId).toBe('signal')
  expect(meta.providers.find(p => p.providerId === 'noise')?.confidence).toBeCloseTo(0.1, 5)
  expect(meta.providers.find(p => p.providerId === 'signal')?.confidence).toBe(1)
})
it('the lexical reranker runs by default and rerank:false restores raw fusion order', async () => {
  const p = defineProvider({ id: 'p', modalities: ['image'], search: async () => [{ ...emit('https://x.test/1'), title: 'Something else' }, { ...emit('https://x.test/2'), title: 'A lion' }] })
  const dflt = await createRefkit({ providers: [p], resilience: false }).search({ query: 'lion', modalities: ['image'] })
  expect(dflt[0].canonicalUrl).toBe('https://x.test/2')
  const raw = await createRefkit({ providers: [p], resilience: false }).search({ query: 'lion', modalities: ['image'], rerank: false })
  expect(raw[0].canonicalUrl).toBe('https://x.test/1')
})
it('minRelevance drops low-scoring results and reports the count', async () => {
  const p = defineProvider({ id: 'p', modalities: ['image'], search: async () => [{ ...emit('https://x.test/1'), title: 'A lion' }, { ...emit('https://x.test/2'), title: 'Unrelated' }] })
  const { references, meta } = await createRefkit({ providers: [p], resilience: false }).searchWithMeta({ query: 'lion', modalities: ['image'], minRelevance: 0.2 })
  expect(references.map(r => r.canonicalUrl)).toEqual(['https://x.test/1'])
  expect(meta.threshold).toEqual({ minRelevance: 0.2, dropped: 1 })
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @refkit/core test`
Expected: FAIL — `weights` ignored, `sourceConfidence` missing, default rerank absent, `minRelevance` unknown.

- [ ] **Step 3: merge weights**

In `merge.ts`: `MergeOptions.weights?: readonly number[]` with doc "Per-list multiplier on RRF contributions (parallel to `perSource`); missing/invalid entries count as 1." In the loop: `const w = opts.weights?.[listIndex]; const weight = typeof w === 'number' && Number.isFinite(w) && w >= 0 ? w : 1; score.set(key, (score.get(key) ?? 0) + weight / (k + rank))` (iterate `perSource.forEach((list, listIndex) => …)`).

- [ ] **Step 4: rerank text, near-dup penalty, sourceScore, confidence**

In `rerank.ts`:

```ts
/** All ranking text a ref carries: title, description, tags, text excerpt. */
export function refText(ref: Pick<Reference, 'title' | 'description' | 'tags' | 'text'>): string {
  return [ref.title, ref.description, ...(ref.tags ?? []), ref.text?.excerpt].filter(Boolean).join(' ')
}

export function lexicalHit(queryTokens: readonly string[], ref: Pick<Reference, 'title' | 'description' | 'tags' | 'text'>): boolean {
  if (queryTokens.length === 0) return false
  const hay = new Set(tokenize(refText(ref)))
  return queryTokens.some(t => hay.has(t))
}

/** How much to trust one source's batch for this query: the fraction of its refs
 *  whose text mentions any query token, floored so a source is dampened, never
 *  erased (non-English titles still get a foothold). 1 for an empty batch. */
export function sourceConfidence(queryTokens: readonly string[], refs: readonly Reference[], floor = 0.1): number {
  if (refs.length === 0 || queryTokens.length === 0) return 1
  const hits = refs.filter(r => lexicalHit(queryTokens, r)).length
  return floor + (1 - floor) * (hits / refs.length)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}
```
`lexicalScore` uses `tokenize(refText(ref))`. `LexicalRerankOptions` gains `nearDuplicatePenalty` (default 0.25), `nearDuplicateThreshold` (default 0.7), `sourceScoreWeight` (default 0). Per-source min-max normalise `sourceScore` into 0..1 (0.5 when a source has no scores or a single value) and add `ssW * normalised` to `base`; `total = lexW + qualW + licW + ssW || 1`. In the greedy loop keep, per source, the list of picked title-token sets; a candidate's adjustment is `base − divW·seenCount − dupW·(maxJaccard against that source's picked titles ≥ threshold ? 1 : 0)`.

- [ ] **Step 5: Client and pipeline wiring**

`client.ts`: `RefkitOptions.sourceConfidence?: boolean | { floor?: number }` (default true), `RefkitOptions.rerank?: Reranker | false` (default `lexicalReranker()` built once in `createRefkit`), `SearchInput.rerank?: Reranker | false`, `SearchInput.minRelevance?: number`, `SearchMeta.threshold?: { minRelevance: number; dropped: number }`, `ProviderSearchStatus.confidence?: number`. Resolve `const reranker = input.rerank === undefined ? defaultReranker : (input.rerank || undefined)` where `defaultReranker = options.rerank === undefined ? lexicalReranker() : (options.rerank || undefined)`. Pass `confidence: options.sourceConfidence === false ? undefined : { floor: typeof options.sourceConfidence === 'object' ? options.sourceConfidence.floor ?? 0.1 : 0.1 }` and `minRelevance: input.minRelevance` into `PassDeps`.

`pipeline.ts`: `PassDeps.confidence?: { floor: number }`, `PassDeps.minRelevance?: number`; `PassOutcome.threshold?: { minRelevance: number; dropped: number }`. In `runPass`, before merge: `const qTokens = [...new Set(tokenize(deps.query))]; const weights = deps.confidence ? perSource.map(list => sourceConfidence(qTokens, list, deps.confidence!.floor)) : undefined` and stamp each fulfilled status with `confidence: weights[i]` (map by the order of fulfilled runs — `collectStatuses` returns `perSource` in that order, so keep a parallel `perSourceIds: string[]`). Pass `weights` into `mergeReferences`. After rerank and gate: `if (deps.minRelevance !== undefined) { const before = refs.length; refs = refs.filter(r => r.relevance >= deps.minRelevance!); threshold = { minRelevance: deps.minRelevance, dropped: before - refs.length } }` then the seen filter. Client copies `last.threshold` into meta and adds `warnings.push(\`${dropped} result(s) below minRelevance ${minRelevance}.\`)` when dropped > 0.

`schemas.ts`: `confidence: z.number().optional()` on the status schema; `threshold: z.object({ minRelevance: z.number(), dropped: z.number() }).optional()` on the meta schema. `index.ts`: export `refText`, `lexicalHit`, `sourceConfidence`.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:run` — green.

```bash
git add -A packages/core
git commit -m "feat(core): source-confidence merge weights, default lexical rerank over richer text, minRelevance"
```

---

### Task 8: Provider acceptance — `accepts`, nailbook scope, polyhaven token matching

**Files:**
- Modify: `packages/core/src/provider.ts`, `select.ts`, `pipeline.ts`, `client.ts`
- Modify: `packages/provider-nailbook/src/index.ts` + test; `packages/provider-polyhaven/src/index.ts` + test
- Test: `select.test.ts`, `client.test.ts`

**Interfaces:**
- Produces: `ReferenceProvider.accepts?(query: { text: string; modalities: Modality[] }): boolean`; skip reason `'declined'` added to `PROVIDER_SKIP_REASONS`; `selectProviders` returns `chosen: []` without throwing when every remaining provider declined.

- [ ] **Step 1: Write failing tests**

select.test.ts:
```ts
it('accepts=false skips with reason declined; an explicit sources entry bypasses it', () => {
  const picky = defineProvider({ id: 'picky', modalities: ['image'], accepts: ({ text }) => /nail/i.test(text), search: async () => [] })
  const open = defineProvider({ id: 'open', modalities: ['image'], search: async () => [] })
  const s = selectProviders([picky, open], { modalities: ['image'], text: 'lion' })
  expect(s.chosen.map(x => x.id)).toEqual(['open'])
  expect(s.skipReasons.get('picky')).toBe('declined')
  const forced = selectProviders([picky, open], { modalities: ['image'], text: 'lion', sources: ['picky'] })
  expect(forced.chosen.map(x => x.id)).toEqual(['picky'])
})
it('when every candidate declines the selection is empty, not an error', () => {
  const picky = defineProvider({ id: 'picky', modalities: ['image'], accepts: () => false, search: async () => [] })
  const s = selectProviders([picky], { modalities: ['image'], text: 'lion' })
  expect(s.chosen).toEqual([])
  expect(s.skipReasons.get('picky')).toBe('declined')
})
```
client.test.ts:
```ts
it('an all-declined search returns an empty result with declined statuses', async () => {
  const picky = defineProvider({ id: 'picky', modalities: ['image'], accepts: () => false, search: async () => [emit('https://x.test/1')] })
  const { references, meta } = await createRefkit({ providers: [picky], resilience: false }).searchWithMeta({ query: 'lion', modalities: ['image'] })
  expect(references).toEqual([])
  expect(meta.providers[0]).toMatchObject({ providerId: 'picky', status: 'skipped', reason: 'declined' })
  expect(meta.nextCursor).toBeUndefined()
})
```
nailbook test:
```ts
it('accepts only nail-art queries', () => {
  const p = nailbook()
  expect(p.accepts?.({ text: 'lion', modalities: ['image'] })).toBe(false)
  expect(p.accepts?.({ text: 'spring nail art', modalities: ['image'] })).toBe(true)
  expect(p.accepts?.({ text: '桜 ネイル', modalities: ['image'] })).toBe(true)
  expect(p.accepts?.({ text: '法式美甲', modalities: ['image'] })).toBe(true)
})
```
polyhaven test (extend the existing fixture list with assets named e.g. `forest_floor` tags `['forest','ground']`, `brick_wall` tags `['brick']`, `mossy_forest_rock` tags `['forest','rock','moss']`):
```ts
it('matches each query token independently and ranks by matched tokens', async () => {
  const refs = await polyhaven().search({ text: 'forest rock', modalities: ['image'] }, ctx)
  expect(refs.map(r => r.sourceUrl)).toEqual(['https://polyhaven.com/a/mossy_forest_rock', 'https://polyhaven.com/a/forest_floor'])
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @refkit/core --filter @refkit/provider-nailbook --filter @refkit/provider-polyhaven test`
Expected: FAIL — `accepts` unknown, `'declined'` not a reason, polyhaven substring-matches the whole phrase.

- [ ] **Step 3: Core**

`provider.ts`: add to `ReferenceProvider`:
```ts
  /** Decline queries this source cannot answer (e.g. a nail-art site for "lion").
   *  Skipped with reason 'declined'; an explicit `sources` whitelist bypasses it. */
  accepts?(query: { text: string; modalities: Modality[] }): boolean
```
`select.ts`: `PROVIDER_SKIP_REASONS = ['unsupported-modality', 'not-selected', 'unsupported-kind', 'declined'] as const`; in `reasonFor`, after the kind check: `if (input.sources == null && p.accepts && !p.accepts({ text: input.text, modalities: input.modalities })) return 'declined'`. The empty-selection throw only fires when no provider was excluded solely by `'declined'`: compute `const onlyDeclined = chosen.length === 0 && [...skipReasons.values()].includes('declined')`; if `onlyDeclined` return `{ chosen: [], skipReasons, unknownSources }`.

`pipeline.ts`: `runPass` already guards the AggregateError with `deps.chosen.length > 0`; with an empty `chosen`, `fanOut` returns `[]`, merge yields `[]`, and the pass returns an empty outcome. `client.ts`: nothing else — `nextCursor` is absent because `references.length === 0`.

- [ ] **Step 4: nailbook and polyhaven**

nailbook: `const NAIL_TERMS = /nail|manicure|ネイル|ジェル|美甲|指甲|甲油/i` and `accepts: ({ text }) => NAIL_TERMS.test(text)` in the `defineProvider` call, with a comment that motif-only searches (e.g. 桜) are reachable via `sources: ['nailbook']`.

polyhaven: replace the client-side filter with
```ts
      const tokens = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const fields = (id: string, a: PolyHavenAsset) => [id, a.name ?? '', ...(a.categories ?? []), ...(a.tags ?? [])].map(s => s.toLowerCase())
      if (tokens.length > 0) {
        entries = entries
          .map(([id, a]) => ({ id, a, hits: tokens.filter(t => fields(id, a).some(f => f.includes(t))).length }))
          .filter(e => e.hits > 0)
          .sort((x, y) => y.hits - x.hits)
          .map(e => [e.id, e.a] as [string, PolyHavenAsset])
      }
```
(keep the rest of `search` — page window, N+1 files fetch — unchanged; `Array.prototype.sort` is stable, so equal-hit assets keep list order).

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:run` — green.

```bash
git add -A packages/core packages/provider-nailbook packages/provider-polyhaven
git commit -m "feat: provider accepts() routing; nailbook declines non-nail queries; polyhaven token matching"
```

---

### Task 9: MCP surface, docs, changeset

**Files:**
- Modify: `packages/mcp/src/index.ts`, `packages/mcp/src/__tests__/mcp.test.ts`, `packages/mcp/README.md`
- Modify: `README.md`, `packages/core/README.md`, `docs/provider-roadmap.md`, `docs/examples/semantic-rerank.md`
- Create: `.changeset/accuracy-and-contract-redesign.md`

**Interfaces:**
- MCP `search_references` gains `minRelevance` (number, optional) and `rerank` defaults to true (`false` restores fusion order); `filters` is gone (Task 2).

- [ ] **Step 1: Write the failing MCP test**

Add to `mcp.test.ts` (using the file's fake-provider server helper):
```ts
it('reranks lexically by default and honours minRelevance', async () => {
  // fake provider emits 'Unrelated' before 'A lion'
  const res = await callTool('search_references', { query: 'lion' })
  expect(res.structuredContent.references[0].title).toBe('A lion')
  const raw = await callTool('search_references', { query: 'lion', rerank: false })
  expect(raw.structuredContent.references[0].title).toBe('Unrelated')
  const cut = await callTool('search_references', { query: 'lion', minRelevance: 0.2, explain: true })
  expect(cut.structuredContent.references).toHaveLength(1)
  expect(cut.structuredContent.meta.threshold).toEqual({ minRelevance: 0.2, dropped: 1 })
})
```
(Adapt `callTool` to however the existing tests invoke tools.)

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @refkit/mcp test` — FAIL (rerank not default, `minRelevance` rejected).

- [ ] **Step 3: MCP**

In `search_references` `inputSchema`: `rerank: z.boolean().optional().describe('default true: re-rank by query relevance over title/description/tags (incl. CJK), resolution and source diversity; false returns raw cross-source fusion order')`, add `minRelevance: z.number().min(0).max(1).optional().describe('drop results whose relevance is below this after reranking (0.2 removes results that match no query term)')`. In the handler: `rerank: rerank === false ? false : undefined` (the client's default lexical reranker applies), `minRelevance`. Remove the `lexicalReranker` import if unused. `sources` handling unchanged.

- [ ] **Step 4: Docs**

`README.md`: Quickstart mentions results are lexically reranked by default; delete the "compatibility alias `filters`" sentences; "Ranking & rerank" section documents default `lexicalReranker`, `rerank: false`, `minRelevance`, source confidence (`sourceConfidence: false` to disable; `meta.providers[].confidence`), and that `Reference` now carries `description`/`tags`/`sourceScore`; "Architecture"/"Core invariants" mention `EmittedReference` (providers describe, core stamps id/provenance/relevance/limit) and facts-driven gating (`RightsRecord.facts`); MCP section: `rerank` default true, `minRelevance`. `packages/core/README.md` and `packages/mcp/README.md`: same edits where they repeat these topics (grep for `filters`, `stricterLicense`, `queryFeatures`, `relevance: 0`, `verifiedAt` and fix each hit). `docs/examples/semantic-rerank.md`: `refText` now comes from core (`import { refText } from '@refkit/core'`) and the recipe overrides the default by passing `rerank: semanticReranker()`. `docs/provider-roadmap.md`: change the "Current inventory" heading to the real count (19 provider packages) — no other roadmap edits.

- [ ] **Step 5: Changeset**

Create `.changeset/accuracy-and-contract-redesign.md` listing every public package (`@refkit/core`, `@refkit/mcp`, and each `@refkit/provider-*` except `@refkit/provider-testkit`) with `minor`, and a body summarising: facts-driven gate, `EmittedReference` provider contract, removed `filters`/`queryFeatures`, default lexical rerank + source confidence + `minRelevance`, `accepts`, `deadlineMs`, `gateContext`, descriptive fields for Met/Artic/Wikimedia/Rijksmuseum.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` — green.

```bash
git add -A
git commit -m "feat(mcp): lexical rerank by default and minRelevance; docs and changeset for the redesign"
```
