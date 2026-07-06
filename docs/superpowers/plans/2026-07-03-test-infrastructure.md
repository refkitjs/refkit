# Wave 3 — Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task. Checkboxes track steps.

**Goal:** (3a) a private `@refkit/provider-testkit` package encoding the provider-conformance rules (D1–D8, H1–H6, schema validity, D8 image-URL rule, licenseVersion guard) as reusable executable assertions; (3b) env-gated live smoke tests against real provider APIs + a weekly GitHub Actions cron — upstream API drift becomes visible instead of silent.

**Architecture:** testkit is `private: true` (never published), consumed as a workspace devDependency. Live smoke reuses the same conformance assertions so one helper serves both fixture tests and live tests. Live tests self-skip via `describe.skipIf` unless `REFKIT_LIVE=1` (and, for BYOK providers, the key env) — so `pnpm test:run` stays hermetic/green with zero config changes; the cron workflow opts in.

**Tech Stack:** TypeScript ESM, vitest, zod (via core), pnpm workspaces, GitHub Actions. Branch: `m13t/wave3-test-infrastructure`.

---

### Task W3.1: `@refkit/provider-testkit` package

**Files:**
- Create: `packages/provider-testkit/package.json`, `tsconfig.json`, `src/index.ts`
- Test: `packages/provider-testkit/src/__tests__/testkit.test.ts`
- Modify: root `vitest.config.ts` ONLY IF it enumerates package paths (read it first; if it globs `packages/*`, no change).

`package.json` (mirror a provider's shape — see provider-met — but `"private": true`, name `@refkit/provider-testkit`, version `0.0.0`, description "Conformance test helpers for refkit provider satellites (internal, not published).", dependency `"@refkit/core": "workspace:*"`, devDeps typescript+vitest matching siblings, scripts: typecheck only — no build/tsup needed since it's consumed from src via workspace).

`src/index.ts`:

```ts
import {
  parseReference, isLikelyImageUrl, CC_FAMILY_BY_TOKEN,
  type Reference, type ReferenceProvider, type NormalizedQuery, type ProviderContext, type LicenseId,
} from '@refkit/core'

/** Licenses allowed to carry rights.licenseVersion (the six versioned CC families). */
const VERSIONED: ReadonlySet<LicenseId> = new Set(Object.values(CC_FAMILY_BY_TOKEN))

export interface ConformanceOptions {
  /** Text query for the search. Default 'landscape'. */
  query?: string
  /** Extra NormalizedQuery fields (providerOptions, limit, controls…). */
  queryExtras?: Partial<NormalizedQuery>
  /** Providers whose modality is image-only must yield image-like preview/thumbnail URLs (D8). Default true when provider.modalities includes 'image'. */
  enforceImageUrls?: boolean
}

/** Run provider.search through the given fetch and assert every conformance rule
 *  refkit demands of a satellite. Throws (with a per-item message) on violation;
 *  returns the parsed refs for further assertions. Works for fixture fetches AND
 *  the real global fetch (live smoke). */
export async function searchConformant(
  provider: ReferenceProvider,
  fetchImpl: typeof fetch,
  opts: ConformanceOptions = {},
): Promise<Reference[]> {
  const query: NormalizedQuery = {
    text: opts.query ?? 'landscape',
    modalities: provider.modalities,
    limit: 5,
    ...opts.queryExtras,
  }
  const ctx: ProviderContext = { fetch: fetchImpl }
  const raw = await provider.search(query, ctx)
  const enforceImages = opts.enforceImageUrls ?? provider.modalities.includes('image')
  return raw.map((item, i) => {
    let ref: Reference
    try {
      ref = parseReference(item) // schema validity incl. provenance trio + rights record
    } catch (e) {
      throw new Error(`[${provider.id}] result #${i} failed referenceSchema: ${(e as Error).message}`)
    }
    if (!ref.id.startsWith(`${provider.id}:`) && !ref.source.providerId.startsWith(provider.id.split('-')[0])) {
      throw new Error(`[${provider.id}] result #${i} id/providerId do not identify the provider (id=${ref.id}, providerId=${ref.source.providerId})`)
    }
    if (ref.rights.licenseVersion !== undefined && !VERSIONED.has(ref.rights.license)) {
      throw new Error(`[${provider.id}] result #${i} carries licenseVersion on non-CC-family license ${ref.rights.license}`)
    }
    if (enforceImages) {
      // D8: preview/thumbnail must be an image resource, never a web page
      if (ref.thumbnail && !isLikelyImageUrl(ref.thumbnail.url)) {
        throw new Error(`[${provider.id}] result #${i} thumbnail.url is not image-like: ${ref.thumbnail.url}`)
      }
      if (ref.preview && !ref.preview.mediaType.startsWith('image/') ) {
        throw new Error(`[${provider.id}] result #${i} image preview has non-image mediaType: ${ref.preview.mediaType}`)
      }
    }
    return ref
  })
}

export interface LicenseMapCase<A> { input: A; expect: { license: LicenseId; version?: string } | LicenseId }

/** Data-driven license-mapping assertion: runs each case and reports every mismatch at once. */
export function expectLicenseMap<A>(
  mapFn: (input: A) => { license: LicenseId; version?: string } | LicenseId,
  cases: ReadonlyArray<LicenseMapCase<A>>,
): void {
  const failures = cases.flatMap(({ input, expect: want }) => {
    const got = mapFn(input)
    return JSON.stringify(got) === JSON.stringify(want) ? [] : [`map(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`]
  })
  if (failures.length > 0) throw new Error(`license mapping mismatches:\n${failures.join('\n')}`)
}
```

Testkit's OWN tests (`__tests__/testkit.test.ts`): a minimal in-file fake provider + fixture fetch; assert (1) a conformant provider passes and returns parsed refs; (2) a provider emitting a page-URL thumbnail fails with the D8 message; (3) a ref with licenseVersion on `CC0-1.0` fails with the guard message; (4) expectLicenseMap reports mismatches and passes on exact matches. TDD: tests first (RED: module missing), then implement.

Verify: `pnpm exec vitest run packages/provider-testkit && pnpm --filter @refkit/provider-testkit typecheck` and full `pnpm -r --parallel typecheck`. Commit: `feat(testkit): provider conformance helpers (private package)`.

---

### Task W3.2: prove the testkit on two providers

**Files:**
- Modify: `packages/provider-openverse/package.json` + `src/__tests__/openverse.test.ts`
- Modify: `packages/provider-europeana/package.json` + `src/__tests__/europeana.test.ts`

Add `"@refkit/provider-testkit": "workspace:*"` to each package's devDependencies (`pnpm install` to link). In each test file ADD (do not remove existing tests) one conformance test reusing an existing fixture-backed fetch: openverse — the existing OPENVERSE fixture route; europeana — its okCtx-style fixture. Shape:

```ts
  it('passes provider conformance (testkit)', async () => {
    const refs = await searchConformant(openverse(), fixtureFetch)
    expect(refs.length).toBeGreaterThan(0)
  })
```

(Adapt fixture names to each file. If a fixture legitimately violates a rule — e.g. europeana page-URL previews are already handled by D8 logic in the provider — the conformance test passing IS the proof; if it fails, the testkit found a real gap: STOP and report BLOCKED with the output rather than weakening the testkit.)

Verify: both provider suites + full `pnpm test:run` green. Commit: `test(providers): adopt testkit conformance checks in openverse + europeana`.

---

### Task W3.3: live smoke tests

**Files:**
- Create: `packages/provider-testkit/src/live.ts` (helper) exporting:

```ts
import { describe, expect, it } from 'vitest'
import type { ReferenceProvider } from '@refkit/core'
import { searchConformant, type ConformanceOptions } from './index'

/** Register an env-gated live smoke suite for a provider. Runs only with
 *  REFKIT_LIVE=1 (and, if keyEnv given, that env var set). One real query,
 *  full conformance assertions, 30s timeout. */
export function liveSmoke(
  name: string,
  make: () => ReferenceProvider,
  opts: ConformanceOptions & { keyEnv?: string } = {},
): void {
  const enabled = process.env.REFKIT_LIVE === '1' && (!opts.keyEnv || !!process.env[opts.keyEnv])
  describe.skipIf(!enabled)(`live smoke: ${name}`, () => {
    it('returns conformant references from the real API', { timeout: 30_000 }, async () => {
      const refs = await searchConformant(make(), globalThis.fetch, opts)
      expect(refs.length).toBeGreaterThan(0)
    })
  })
}
```

- Create per-provider `src/__tests__/live.test.ts` in these packages (each ~6 lines, using liveSmoke; add testkit devDep where missing):
  - keyless: met, artic, wikimedia-commons, openverse (`openverse()` and `openverseAudio()` in one file), gutendex, poetrydb, rijksmuseum, polyhaven (`polyhaven()` + `ambientcg()`), internet-archive
  - BYOK (keyEnv per cli.ts convention): unsplash (`UNSPLASH_KEY`), pexels (`PEXELS_KEY`), pixabay (`PIXABAY_KEY`), flickr (`FLICKR_KEY`), smithsonian (`SI_KEY`), brave (`BRAVE_TOKEN`), freesound (`FREESOUND_TOKEN`), jamendo (`JAMENDO_CLIENT_ID`), europeana (`EUROPEANA_KEY`)
  - BYOK factories take config objects — construct with the env var, e.g. `liveSmoke('unsplash', () => unsplash({ accessKey: process.env.UNSPLASH_KEY! }), { keyEnv: 'UNSPLASH_KEY' })`.
  - Query choice: default 'landscape' works for image/audio; text providers (gutendex, poetrydb) pass `{ query: 'love' }`. brave results are license-unknown — conformance still passes (unknown is valid).
- Root `package.json`: add script `"test:live": "REFKIT_LIVE=1 vitest run"` (note in the plan: fine for macOS/Linux CI; Windows devs can set the var manually).

Verify hermetic default: `pnpm test:run` → all live suites reported skipped, totals otherwise unchanged. Then a REAL spot check: `REFKIT_LIVE=1 pnpm exec vitest run packages/provider-met packages/provider-poetrydb` (two stable keyless APIs) — expect green; if an API is down/drifted, report findings rather than skipping silently. Commit: `test(providers): env-gated live smoke suites (REFKIT_LIVE=1)`.

---

### Task W3.4: weekly cron workflow + docs

**Files:**
- Create: `.github/workflows/live-smoke.yml`:

```yaml
name: live-smoke
on:
  schedule:
    - cron: '17 3 * * 1' # Mondays 03:17 UTC — weekly upstream drift check
  workflow_dispatch: {}

jobs:
  live:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Live smoke (keyless always; BYOK when secrets exist)
        env:
          REFKIT_LIVE: '1'
          UNSPLASH_KEY: ${{ secrets.UNSPLASH_KEY }}
          PEXELS_KEY: ${{ secrets.PEXELS_KEY }}
          PIXABAY_KEY: ${{ secrets.PIXABAY_KEY }}
          FLICKR_KEY: ${{ secrets.FLICKR_KEY }}
          SI_KEY: ${{ secrets.SI_KEY }}
          BRAVE_TOKEN: ${{ secrets.BRAVE_TOKEN }}
          FREESOUND_TOKEN: ${{ secrets.FREESOUND_TOKEN }}
          JAMENDO_CLIENT_ID: ${{ secrets.JAMENDO_CLIENT_ID }}
          EUROPEANA_KEY: ${{ secrets.EUROPEANA_KEY }}
        run: pnpm vitest run
```

(Mirror ci.yml's actual setup steps — read it first and copy its pnpm/node versions; the env-gated skipIf means a plain `vitest run` runs live suites plus normal suites, which doubles as a full check. If ci.yml uses different action versions, match them.)
- README Develop section: add one line — `REFKIT_LIVE=1 pnpm test:run` runs live smoke against real APIs (weekly cron does this in CI).
- No changeset: testkit is private, live tests + workflow are dev-only, provider devDependency additions don't change published artifacts. State this explicitly in the commit body.

Verify: `pnpm -r --parallel typecheck && pnpm test:run` all green; `actionlint` if available (else careful YAML read). Commit: `ci: weekly live-smoke workflow + docs`.

---

## Self-review notes

- Testkit deliberately throws plain Errors (framework-agnostic) — vitest surfaces them fine; no vitest dependency in index.ts (live.ts DOES import vitest — that's fine, it's only used from test files).
- searchConformant's id check is heuristic (openverse-audio's id prefix is 'openverse-audio' while provider.id matches) — implementer: verify against real provider id conventions and loosen ONLY as far as needed; report what rule you settled on.
- Line anchors may drift; locate by quoted code.
