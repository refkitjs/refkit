# Live Smoke Provider Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deterministic keyless provider live-smoke checks pass against current upstream contracts.

**Architecture:** Keep each fix inside its provider package. Bound queries at the upstream API, use Rijksmuseum's one-hop EDM JSON-LD profile, and preserve existing `Reference` semantics and local result caps.

**Tech Stack:** TypeScript 5.9, Vitest 3.2, pnpm 10, native `fetch`/`URL`.

## Global Constraints

- No production behavior change for Gutendex in this plan.
- No new dependencies.
- Preserve provider IDs, `referenceId` construction, rights mapping, and normalized `q.limit` semantics.
- Write each regression test first and observe the expected failure before production edits.
- Do not modify or stage the pre-existing untracked files under `docs/superpowers/plans/`.

---

### Task 1: Bound Internet Archive to supported media types

**Files:**
- Modify: `packages/provider-internet-archive/src/index.ts:89-105`
- Test: `packages/provider-internet-archive/src/__tests__/internet-archive.test.ts:171-186`

**Interfaces:**
- Consumes: `NormalizedQuery.text`, `NormalizedQuery.limit`, `InternetArchiveConfig.maxRows`.
- Produces: an Advanced Search request whose `q` is `(<text>) AND mediatype:(movies OR texts)`.

- [ ] **Step 1: Write the failing request-construction assertion**

```ts
expect(url.searchParams.get('q')).toBe('(jazz) AND mediatype:(movies OR texts)')
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run packages/provider-internet-archive/src/__tests__/internet-archive.test.ts`

Expected: the request test fails because the current value is `jazz`.

- [ ] **Step 3: Implement the server-side media filter**

```ts
url.searchParams.set('q', `(${q.text}) AND mediatype:(movies OR texts)`)
```

- [ ] **Step 4: Run the suite and verify GREEN**

Run: `pnpm vitest run packages/provider-internet-archive/src/__tests__/internet-archive.test.ts`

Expected: all Internet Archive unit tests pass.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add packages/provider-internet-archive/src/index.ts packages/provider-internet-archive/src/__tests__/internet-archive.test.ts
git commit -m "fix(provider-internet-archive): filter supported media upstream"
```

---

### Task 2: Apply PoetryDB query limits upstream

**Files:**
- Modify: `packages/provider-poetrydb/src/index.ts:55-104`
- Test: `packages/provider-poetrydb/src/__tests__/poetrydb.test.ts`

**Interfaces:**
- Consumes: `NormalizedQuery.text`, `NormalizedQuery.limit`, `PoetryDbSearchOptions`.
- Produces: a default bounded URL such as `https://poetrydb.org/lines,poemcount/love;5`.

- [ ] **Step 1: Add failing URL tests**

```ts
it('maps q.limit to poemcount for the default line search', async () => {
  let calledUrl = ''
  const ctx = responding([], url => { calledUrl = url })
  await poetrydb().search({ text: 'love', modalities: ['text'], limit: 5 }, ctx)
  expect(calledUrl).toBe('https://poetrydb.org/lines,poemcount/love;5')
})
```

Also cover that an explicit positive `poemCount` overrides `q.limit`, while an explicit positive `random` suppresses the implicit `poemcount`.

```ts
expect(urlFor({ poemCount: 3 }, 5)).toBe('https://poetrydb.org/lines,poemcount/love;3')
expect(urlFor({ random: 2 }, 5)).toBe('https://poetrydb.org/lines,random/love;2')
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm vitest run packages/provider-poetrydb/src/__tests__/poetrydb.test.ts`

Expected: the default URL is currently `https://poetrydb.org/lines/love`.

- [ ] **Step 3: Implement bounded URL construction**

Change `poetrydbUrl` to accept `limit`. Seed default input with `fields=['lines']` and `terms=[text]`, then append one count control:

```ts
function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

const explicitRandom = positiveInt(options?.random)
const explicitCount = positiveInt(options?.poemCount)
const implicitCount = positiveInt(limit)

if (fields.length === 0 && terms.length === 0) {
  fields.push('lines')
  terms.push(text)
}
if (explicitRandom !== undefined && !fields.includes('random')) {
  fields.push('random')
  terms.push(String(explicitRandom))
} else if (!fields.includes('poemcount')) {
  const count = explicitCount ?? implicitCount
  if (count !== undefined) {
    fields.push('poemcount')
    terms.push(String(count))
  }
}
```

Pass `q.limit` from `search`. Preserve an already explicit `poemcount` field and its paired search term.

- [ ] **Step 4: Run the suite and verify GREEN**

Run: `pnpm vitest run packages/provider-poetrydb/src/__tests__/poetrydb.test.ts`

Expected: all PoetryDB unit tests pass.

- [ ] **Step 5: Commit only Task 2 files**

```bash
git add packages/provider-poetrydb/src/index.ts packages/provider-poetrydb/src/__tests__/poetrydb.test.ts
git commit -m "fix(provider-poetrydb): bound searches with poemcount"
```

---

### Task 3: Adapt Rijksmuseum to the current search and EDM contracts

**Files:**
- Modify: `packages/provider-rijksmuseum/src/index.ts`
- Test: `packages/provider-rijksmuseum/src/__tests__/rijksmuseum.test.ts`

**Interfaces:**
- Consumes: the current collection search page and one `edm-framed` aggregation per selected ID.
- Produces: image references using `aggregatedCHO.id`, localized title/creator metadata, `edmRights`, `isShownAt.id`, and `isShownBy.id`.

- [ ] **Step 1: Add failing contract tests**

Update the search URL assertion:

```ts
expect(url.searchParams.get('pageSize')).toBeNull()
```

Use an EDM fixture with this minimum shape and assert the record URL ends in `_profile=edm-framed`:

```ts
const EDM = {
  id: 'https://id.rijksmuseum.nl/1#aggregation',
  edmRights: 'http://creativecommons.org/publicdomain/mark/1.0/',
  isShownAt: { id: 'https://www.rijksmuseum.nl/en/collection/object-1' },
  isShownBy: { id: 'https://iiif.micr.io/example/full/max/0/default.jpg' },
  aggregatedCHO: {
    id: 'https://id.rijksmuseum.nl/1',
    title: { en: ['Landscape'], nl: ['Landschap'] },
    creator: [{
      'http://www.w3.org/2004/02/skos/core#prefLabel': [
        { '@language': 'en', '@value': 'Example Maker' },
      ],
    }],
  },
}
```

Assert title `Landscape`, author `Example Maker`, PD rights, canonical ID URL, and IIIF thumbnail/preview.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm vitest run packages/provider-rijksmuseum/src/__tests__/rijksmuseum.test.ts`

Expected: `pageSize` is present, the profile is `la`, and the Linked Art mapper cannot map the EDM fixture.

- [ ] **Step 3: Implement the current contract**

Remove `pageSize`. Request each selected record with `_profile=edm-framed`. Replace the Linked Art-specific mapper with focused helpers that:

```ts
const canonicalUrl = rec.aggregatedCHO?.id
const imageUrl = rec.isShownBy?.id ?? rec.object?.id
const title = firstLocalized(rec.aggregatedCHO?.title, ['en', 'nl'])
const author = firstCreatorLabel(rec.aggregatedCHO?.creator, ['en', 'nl'])
const { license, version, jurisdiction } = mapRightsUrl(rec.edmRights)
```

Return `null` when canonical ID or image is absent. Keep one-record failure isolation and `.slice(0, n)`.

- [ ] **Step 4: Run the suite and verify GREEN**

Run: `pnpm vitest run packages/provider-rijksmuseum/src/__tests__/rijksmuseum.test.ts`

Expected: all Rijksmuseum unit tests pass.

- [ ] **Step 5: Commit only Task 3 files**

```bash
git add packages/provider-rijksmuseum/src/index.ts packages/provider-rijksmuseum/src/__tests__/rijksmuseum.test.ts
git commit -m "fix(provider-rijksmuseum): use current EDM API contract"
```

---

### Task 4: Integration verification and live recheck

**Files:**
- Verify only; no planned production files.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: fresh local evidence for unit, type, build, and real upstream behavior.

- [ ] **Step 1: Run targeted unit suites**

Run: `pnpm vitest run packages/provider-internet-archive/src/__tests__/internet-archive.test.ts packages/provider-poetrydb/src/__tests__/poetrydb.test.ts packages/provider-rijksmuseum/src/__tests__/rijksmuseum.test.ts`

Expected: all targeted tests pass.

- [ ] **Step 2: Run the three keyless live suites**

Run: `REFKIT_LIVE=1 pnpm vitest run packages/provider-internet-archive/src/__tests__/live.test.ts packages/provider-poetrydb/src/__tests__/live.test.ts packages/provider-rijksmuseum/src/__tests__/live.test.ts`

Expected: all three live tests pass.

- [ ] **Step 3: Re-probe Gutendex without changing code**

Run: `REFKIT_LIVE=1 pnpm vitest run packages/provider-gutendex/src/__tests__/live.test.ts`

Expected: record pass/fail as external evidence; a repeated 403 is a follow-up diagnostics task, not permission to alter UA behavior here.

- [ ] **Step 4: Run repository gates**

Run: `pnpm typecheck`

Run: `pnpm test:run`

Run: `pnpm build`

Run: `git diff --check`

Expected: all commands exit 0.

- [ ] **Step 5: Review the full branch diff**

Compare the branch against its starting commit, verify only the six provider source/test files and approved plan/spec artifacts changed, and resolve all Critical or Important findings before handoff.
