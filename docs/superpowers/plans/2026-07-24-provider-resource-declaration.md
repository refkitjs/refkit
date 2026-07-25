# Provider Resource Declaration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Providers declare what they provide at two granularities (`modalities` + open `kinds` vocabulary) plus a one-line `description`; core routes by these declarations (including a new `providers` id whitelist), and the MCP server derives its tool schema and description from them at startup.

**Architecture:** All declaration data lives on the `ReferenceProvider` object (single source of truth). Core's provider-selection predicate in `client.ts` grows two narrowing steps (id whitelist, kind match) with explain-metadata skip reasons. `createRefkitMcpServer` reads `refkit.providers` at construction to build dynamic zod enums and a per-provider source list in the tool description.

**Tech Stack:** TypeScript, zod, vitest, pnpm workspaces, changesets. Spec: `docs/superpowers/specs/2026-07-24-provider-resource-declaration-design.md`.

**Conventions:** Run all commands from the repo root. Test commands use `pnpm vitest run <path>` (vitest workspace resolves the right project config). Every task ends with a commit.

---

### Task 1: core types — `ResourceKind`, `ReferenceProvider.kinds` / `.description`

**Files:**
- Modify: `packages/core/src/provider.ts` (after the `SearchSafety` line, and inside `ReferenceProvider` / `SearchMediaControls`)
- Modify: `packages/core/src/index.ts` (type exports)
- Test: `packages/core/src/__tests__/provider.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/__tests__/provider.test.ts` (it already imports `defineProvider` — if not, add `import { defineProvider } from '../provider'`):

```ts
describe('resource declarations', () => {
  it('defineProvider preserves kinds and description (open vocabulary)', () => {
    const p = defineProvider({
      id: 'x',
      modalities: ['image'],
      kinds: ['texture', 'my-custom-kind'], // well-known + custom must both typecheck
      description: 'CC0 textures for tests',
      search: async () => [],
    })
    expect(p.kinds).toEqual(['texture', 'my-custom-kind'])
    expect(p.description).toBe('CC0 textures for tests')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/provider.test.ts`
Expected: FAIL — TS error: `kinds` does not exist on the provider type.

- [ ] **Step 3: Implement**

In `packages/core/src/provider.ts`, after the `export type SearchSafety = …` line (line 16), add:

```ts
/** Fine-grained resource kind. Open vocabulary: well-known values get
 *  autocomplete; any other string is a valid custom kind. Well-known values are
 *  hints, not validation — core never rejects unknown kinds. */
export type WellKnownKind =
  | 'photo' | 'illustration' | 'vector' | 'icon' | 'artwork'
  | 'texture' | 'hdri' | '3d-model'
  | 'film' | 'animation'
  | 'music' | 'sound-effect'
  | 'ebook' | 'poem'
export type ResourceKind = WellKnownKind | (string & {})
```

In `SearchMediaControls`, widen the `kind` field (keep the other fields untouched):

```ts
export interface SearchMediaControls {
  kind?: ResourceKind
  size?: 'small' | 'medium' | 'large'
  minWidth?: number
  minHeight?: number
  duration?: 'short' | 'medium' | 'long'
}
```

In `ReferenceProvider`, after the `modalities: Modality[]` line, add:

```ts
  /** Fine-grained kinds this provider offers (routing: a kind-filtered search
   *  skips providers whose declared kinds lack the requested value; undeclared
   *  providers are conservatively included). Orthogonal to the `media.kind`
   *  entry in capabilities.controls, which declares upstream FILTER support. */
  kinds?: readonly ResourceKind[]
  /** One-line content-domain summary, surfaced in the MCP tool's source list
   *  so an agent can judge topical fit (e.g. "CC0 PBR textures for 3D work"). */
  description?: string
```

In `packages/core/src/index.ts`, add `WellKnownKind` and `ResourceKind` to the type-export block from `'./provider'` (the block at lines 26–45):

```ts
  WellKnownKind,
  ResourceKind,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/provider.ts packages/core/src/index.ts packages/core/src/__tests__/provider.test.ts
git commit -m "feat(core): ResourceKind vocabulary + provider kinds/description declarations"
```

---

### Task 2: core — `Reference.kind`

**Files:**
- Modify: `packages/core/src/reference.ts`
- Test: `packages/core/src/__tests__/reference.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/__tests__/reference.test.ts` (reuse the file's existing valid-reference fixture if one exists; otherwise use this base):

```ts
it('accepts an optional fine-grained kind', () => {
  const base = {
    id: 'p:1',
    modality: 'image',
    source: { providerId: 'p', sourceUrl: 'https://p/1' },
    canonicalUrl: 'https://p/1',
    rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://p/1' } },
    verifiedAt: '2026-07-24T00:00:00.000Z',
    relevance: 0,
  }
  expect(parseReference({ ...base, kind: 'texture' }).kind).toBe('texture')
  expect(parseReference(base).kind).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/reference.test.ts`
Expected: FAIL — TS: `kind` does not exist on type `Reference` (the `.kind` read on the parse result).

- [ ] **Step 3: Implement**

In `packages/core/src/reference.ts`, add to the `Reference` interface after `modality: Modality`:

```ts
  /** Fine-grained kind (open vocabulary, see ResourceKind), e.g. 'photo', 'texture'. */
  kind?: string
```

And in `referenceSchema`, after `modality: modalitySchema,`:

```ts
  kind: z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/reference.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reference.ts packages/core/src/__tests__/reference.test.ts
git commit -m "feat(core): optional Reference.kind"
```

---

### Task 3: core routing — kind match + `unsupported-kind` skip reason

**Files:**
- Modify: `packages/core/src/client.ts` (lines 64–74 `ProviderSearchStatus`, 196–199 selection, 239–242 status seeding, 379 meta fallback)
- Test: `packages/core/src/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/__tests__/client.test.ts` (the file already defines `ref(…)` and `provider(…)` helpers at the top — reuse `ref`):

```ts
describe('kind-aware routing', () => {
  const kindProvider = (id: string, kinds: readonly string[], refs: Reference[]) =>
    defineProvider({ id, modalities: ['image'], kinds, search: async () => refs })

  it('skips providers whose declared kinds lack the requested value', async () => {
    const rk = createRefkit({ providers: [
      kindProvider('tex', ['texture'], [ref('tex-1', 'https://t/1')]),
      kindProvider('ph', ['photo'], [ref('ph-1', 'https://p/1')]),
    ] })
    const { references, meta } = await rk.searchWithMeta({
      query: 'x', modalities: ['image'], controls: { media: { kind: 'texture' } },
    })
    expect(references.map(r => r.canonicalUrl)).toEqual(['https://t/1'])
    expect(meta.providers.find(p => p.providerId === 'ph'))
      .toMatchObject({ status: 'skipped', reason: 'unsupported-kind' })
  })

  it('conservatively includes providers that declare no kinds', async () => {
    const rk = createRefkit({ providers: [
      provider('legacy', [ref('legacy-1', 'https://l/1')]), // no kinds declared
      kindProvider('ph', ['photo'], [ref('ph-1', 'https://p/1')]),
    ] })
    const out = await rk.search({
      query: 'x', modalities: ['image'], controls: { media: { kind: 'texture' } },
    })
    expect(out.map(r => r.canonicalUrl)).toEqual(['https://l/1'])
  })

  it('throws with the kind in the message when nothing matches', async () => {
    const rk = createRefkit({ providers: [kindProvider('ph', ['photo'], [])] })
    await expect(rk.search({
      query: 'x', modalities: ['image'], controls: { media: { kind: 'texture' } },
    })).rejects.toThrow('kind "texture"')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/__tests__/client.test.ts`
Expected: the three new tests FAIL (all providers still queried; no `unsupported-kind` reason). Pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `packages/core/src/client.ts`:

(a) Widen `ProviderSearchStatus.reason` (line 70):

```ts
  reason?: 'unsupported-modality' | 'unsupported-kind'
```

(b) Replace the selection block (lines 196–199):

```ts
    const kindFilter = input.controls?.media?.kind
    const skipReasonFor = (p: ReferenceProvider): NonNullable<ProviderSearchStatus['reason']> | undefined => {
      if (!p.modalities.some(m => input.modalities.includes(m))) return 'unsupported-modality'
      if (kindFilter !== undefined && p.kinds && !p.kinds.includes(kindFilter)) return 'unsupported-kind'
      return undefined
    }
    const skipReasons = new Map<string, NonNullable<ProviderSearchStatus['reason']>>()
    for (const p of options.providers) {
      const reason = skipReasonFor(p)
      if (reason) skipReasons.set(p.id, reason)
    }
    const chosen = options.providers.filter(p => !skipReasons.has(p.id))
    if (chosen.length === 0) {
      throw new Error(
        `refkit.search: no registered provider supports modalities [${input.modalities.join(', ')}]`
        + (kindFilter !== undefined ? ` with kind "${kindFilter}"` : ''),
      )
    }
```

Note: the modality-only message is byte-identical to today's — the existing
assertion at `client.test.ts:266` must keep passing.

(c) Replace the status-seeding loop inside `runPass` (lines 240–242):

```ts
      for (const p of options.providers) {
        const reason = skipReasons.get(p.id)
        if (reason) statusByProvider.set(p.id, { providerId: p.id, status: 'skipped', reason })
      }
```

(d) Update the meta fallback (line 379):

```ts
        providers: options.providers.map(p => pass.statusByProvider.get(p.id)
          ?? { providerId: p.id, status: 'skipped', reason: skipReasons.get(p.id) ?? 'unsupported-modality' }),
```

- [ ] **Step 4: Run the full core suite**

Run: `pnpm vitest run packages/core`
Expected: PASS (including the pre-existing exact-message test at line 266).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/client.ts packages/core/src/__tests__/client.test.ts
git commit -m "feat(core): kind-aware provider routing with unsupported-kind skip reason"
```

---

### Task 4: core routing — `providers` id whitelist

**Files:**
- Modify: `packages/core/src/client.ts` (`SearchInput`, `ProviderSearchStatus.reason`, selection block, warnings init at line 361)
- Test: `packages/core/src/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/__tests__/client.test.ts`:

```ts
describe('providers whitelist', () => {
  it('restricts fan-out and reports not-selected in meta', async () => {
    const rk = createRefkit({ providers: [
      provider('a', [ref('a-1', 'https://a/1')]),
      provider('b', [ref('b-1', 'https://b/1')]),
    ] })
    const { references, meta } = await rk.searchWithMeta({ query: 'x', modalities: ['image'], providers: ['a'] })
    expect(references.map(r => r.canonicalUrl)).toEqual(['https://a/1'])
    expect(meta.providers.find(p => p.providerId === 'b'))
      .toMatchObject({ status: 'skipped', reason: 'not-selected' })
  })

  it('warns on unknown ids and still runs the valid remainder', async () => {
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')])] })
    const { references, meta } = await rk.searchWithMeta({ query: 'x', modalities: ['image'], providers: ['a', 'nope'] })
    expect(references).toHaveLength(1)
    expect(meta.warnings.some(w => w.includes('"nope"'))).toBe(true)
  })

  it('throws when the whitelist selects nothing', async () => {
    const rk = createRefkit({ providers: [provider('a', [])] })
    await expect(rk.search({ query: 'x', modalities: ['image'], providers: ['nope'] }))
      .rejects.toThrow(/no registered provider/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/__tests__/client.test.ts`
Expected: the three new tests FAIL (TS: `providers` not on `SearchInput`).

- [ ] **Step 3: Implement**

In `packages/core/src/client.ts`:

(a) `SearchInput` — after the `providerOptions` field:

```ts
  /** Restrict this search to these provider ids. Unknown ids append a warning
   *  to meta.warnings and are otherwise ignored; excluded providers appear in
   *  meta.providers as skipped with reason 'not-selected'. */
  providers?: readonly string[]
```

(b) `ProviderSearchStatus.reason` — add the third value:

```ts
  reason?: 'unsupported-modality' | 'unsupported-kind' | 'not-selected'
```

(c) In the selection block from Task 3, insert before `const kindFilter = …`:

```ts
    const idWhitelist = input.providers
    const preWarnings: string[] = []
    if (idWhitelist) {
      const known = new Set(options.providers.map(p => p.id))
      for (const id of idWhitelist) {
        if (!known.has(id)) preWarnings.push(`unknown provider id in providers: "${id}"`)
      }
    }
```

and make the whitelist the FIRST check inside `skipReasonFor` (spec: reason
reflects the first step that excluded the provider):

```ts
      if (idWhitelist && !idWhitelist.includes(p.id)) return 'not-selected'
```

Extend the empty-selection error with the whitelist segment (append after the kind segment):

```ts
        + (idWhitelist ? ` within providers [${idWhitelist.join(', ')}]` : ''),
```

(d) Warnings init (line 361) — carry the pre-warnings:

```ts
    const warnings: string[] = [...preWarnings]
```

- [ ] **Step 4: Run the full core suite**

Run: `pnpm vitest run packages/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/client.ts packages/core/src/__tests__/client.test.ts
git commit -m "feat(core): providers id whitelist with not-selected skip reason and unknown-id warnings"
```

---

### Task 5: testkit — declared-kinds consistency check

**Files:**
- Modify: `packages/provider-testkit/src/index.ts` (inside `searchConformant`'s per-item loop, after the `source.providerId` check at line 57–59)
- Test: `packages/provider-testkit/src/__tests__/testkit.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/provider-testkit/src/__tests__/testkit.test.ts` (reuse the file's existing fake-provider/fetch helpers if present; this block is self-contained either way):

```ts
import { defineProvider, type Reference } from '@refkit/core'
import { searchConformant } from '../index'

const kindRef = (kind?: string): Reference => ({
  id: 'kp:1',
  modality: 'image',
  ...(kind ? { kind } : {}),
  source: { providerId: 'kp', sourceUrl: 'https://kp/1' },
  canonicalUrl: 'https://kp/1',
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://kp/1' } },
  verifiedAt: '2026-07-24T00:00:00.000Z',
  relevance: 0,
})

describe('declared-kinds consistency', () => {
  const neverFetch = (async () => { throw new Error('no network') }) as unknown as typeof fetch

  it('rejects a result whose kind is outside the declared set', async () => {
    const p = defineProvider({ id: 'kp', modalities: ['image'], kinds: ['texture'], search: async () => [kindRef('photo')] })
    await expect(searchConformant(p, neverFetch)).rejects.toThrow(/kind "photo" is not in the provider's declared kinds/)
  })

  it('accepts a matching kind and a missing kind', async () => {
    const p = defineProvider({ id: 'kp', modalities: ['image'], kinds: ['texture'], search: async () => [kindRef('texture'), kindRef()] })
    await expect(searchConformant(p, neverFetch)).resolves.toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/provider-testkit`
Expected: the first new test FAILS (no error thrown for the mismatched kind).

- [ ] **Step 3: Implement**

In `packages/provider-testkit/src/index.ts`, inside the `raw.map((item, i) => { … })` loop, after the `source.providerId` check (line 57–59), add:

```ts
    // Declared-kinds consistency: a provider stating what it offers must not
    // emit results outside that set. Missing kind is allowed (annotation is
    // optional); only a contradicting value is a violation.
    if (provider.kinds && provider.kinds.length > 0 && ref.kind !== undefined && !provider.kinds.includes(ref.kind)) {
      throw new Error(`[${provider.id}] result #${i} kind "${ref.kind}" is not in the provider's declared kinds [${provider.kinds.join(', ')}]`)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/provider-testkit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/provider-testkit/src/index.ts packages/provider-testkit/src/__tests__/testkit.test.ts
git commit -m "feat(testkit): enforce declared-kinds consistency in searchConformant"
```

---

### Task 6: MCP — dynamic schema, source list, `providers` parameter, `kind` in output

**Files:**
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/mcp/src/__tests__/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/mcp/src/__tests__/mcp.test.ts` (file already imports `createRefkit`, `defineProvider`, `createRefkitMcpServer`, `Client`, `InMemoryTransport`):

```ts
describe('dynamic declaration-derived schema', () => {
  async function declClient() {
    const tex = defineProvider({
      id: 'texsrc', modalities: ['image'], kinds: ['texture', 'custom-kind'],
      description: 'CC0 textures for tests', search: async () => [],
    })
    const plain = defineProvider({ id: 'plain', modalities: ['audio'], search: async () => [] })
    const refkit = createRefkit({ providers: [tex, plain], fetch: (async () => new Response('{}')) as typeof fetch })
    const server = createRefkitMcpServer(refkit)
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([client.connect(clientT), server.connect(serverT)])
    return client
  }

  it('appends a per-provider source list to the tool description', async () => {
    const client = await declClient()
    const { tools } = await client.listTools()
    const tool = tools.find(t => t.name === 'search_references')!
    expect(tool.description).toContain('Configured sources:')
    expect(tool.description).toContain('- texsrc (image·texture,custom-kind): CC0 textures for tests')
    expect(tool.description).toContain('- plain (audio)')
    await client.close()
  })

  it('derives modalities / media.kind / providers enums from declarations', async () => {
    const client = await declClient()
    const { tools } = await client.listTools()
    const schema = tools.find(t => t.name === 'search_references')!.inputSchema as Record<string, any>
    const modalityEnum = schema.properties.modalities.items.enum as string[]
    expect(modalityEnum.sort()).toEqual(['audio', 'image'])
    const providerEnum = schema.properties.providers.items.enum as string[]
    expect(providerEnum).toEqual(['texsrc', 'plain'])
    const kindEnum = schema.properties.controls.properties.media.properties.kind.enum as string[]
    expect(kindEnum).toEqual(expect.arrayContaining(['photo', 'illustration', 'vector', 'film', 'animation', 'texture', 'custom-kind']))
    await client.close()
  })
})
```

If the JSON-schema property paths differ from the SDK's actual zod conversion,
`console.log(JSON.stringify(schema, null, 2))` once, correct the paths in the
test, and remove the log.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp`
Expected: the two new tests FAIL (static description, static enums, no `providers` property).

- [ ] **Step 3: Implement**

In `packages/mcp/src/index.ts`:

(a) After the `ORIENTATIONS` constant, add:

```ts
// Legacy media.kind control values — kept in the dynamic enum because they stay
// meaningful as upstream filter translations for providers that support the
// media.kind control without declaring kinds.
const BASE_MEDIA_KINDS = ['photo', 'illustration', 'vector', 'film', 'animation'] as const
```

(b) Turn the module-level `searchControlsSchema` into a factory (replace the `const searchControlsSchema = z.object({ … })` block; the body is identical except the `media.kind` line):

```ts
function buildSearchControlsSchema(kindValues: [string, ...string[]]) {
  return z.object({
    orientation: z.enum(ORIENTATIONS).optional(),
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
      kind: z.enum(kindValues).optional(),
      size: z.enum(['small', 'medium', 'large']).optional(),
      minWidth: z.number().int().nonnegative().optional(),
      minHeight: z.number().int().nonnegative().optional(),
      duration: z.enum(['short', 'medium', 'long']).optional(),
    }).optional(),
    creator: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    text: z.object({
      copyright: z.enum(['public-domain', 'copyrighted', 'any']).optional(),
    }).optional(),
    page: z.number().int().positive().optional(),
  })
}
```

(c) `toAgentRef` — add `kind: r.kind,` to the `base` object (after `modality`), and add to `agentRefSchema` after `modality: z.string(),`:

```ts
  kind: z.string().optional().describe('fine-grained resource kind, e.g. photo / texture / ebook'),
```

(d) `searchMetaSchema` — widen the provider skip-reason enum (line 140):

```ts
    reason: z.enum(['unsupported-modality', 'unsupported-kind', 'not-selected']).optional(),
```

(e) In `createRefkitMcpServer`, before `server.registerTool('search_references', …)`, derive everything from declarations:

```ts
  const registered = refkit.providers
  const modalityValues = [...new Set(registered.flatMap(p => p.modalities))] as [Modality, ...Modality[]]
  const kindValues = [...new Set<string>([...BASE_MEDIA_KINDS, ...registered.flatMap(p => p.kinds ?? [])])] as [string, ...string[]]
  const providerIds = registered.map(p => p.id) as [string, ...string[]]
  const sourceList = registered.map(p => {
    const kinds = p.kinds?.length ? `·${p.kinds.join(',')}` : ''
    const desc = p.description ? `: ${p.description}` : ''
    return `- ${p.id} (${p.modalities.join('/')}${kinds})${desc}`
  }).join('\n')
  const searchControlsSchema = buildSearchControlsSchema(kindValues)
```

Add `import type { Modality } from '@refkit/core'` if `Modality` is not already imported.

(f) In the `search_references` registration:
- description: append `` + '\n\nConfigured sources:\n' + sourceList `` to the existing string.
- `modalities` input: `z.array(z.enum(modalityValues)).optional().describe('default ["image"]')`
  and drop the now-unused static `MODALITIES` reference there (keep the
  `MODALITIES` constant — `searchMetaSchema` still uses it).
- add after `providerOptions`:

```ts
        providers: z.array(z.enum(providerIds)).optional().describe('restrict the search to these source ids (see Configured sources in this tool description)'),
```

- handler: add `providers` to the destructured args and pass `providers` through in `searchInput`.

- [ ] **Step 4: Run the full mcp suite**

Run: `pnpm vitest run packages/mcp`
Expected: PASS (new tests and all pre-existing ones — the pre-existing tests exercise the openverse-only server, whose derived enums are supersets of what they use).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/index.ts packages/mcp/src/__tests__/mcp.test.ts
git commit -m "feat(mcp): declaration-derived schema, source list, providers parameter, kind in output"
```

---

### Task 7: provider declarations — photo/stock group

**Files:**
- Modify: `packages/provider-unsplash/src/index.ts` (factory at line 61, `toReference` modality line 45)
- Modify: `packages/provider-pexels/src/index.ts` (factories at 72 and 132, modality lines 56 and 115)
- Modify: `packages/provider-pixabay/src/index.ts` (factories at 100 and 183, modality lines 84 and 165, `PixabayHit` interface)
- Modify: `packages/provider-flickr/src/index.ts` (factory at 182, modality line 165)
- Test: each package's main test file (`unsplash.test.ts`, `pexels.test.ts`, `pixabay.test.ts`, `flickr.test.ts`)

Pattern for every provider in Tasks 7–10: insert `kinds` + `description` in the
`defineProvider({ … })` literal directly after its `modalities` line; insert
`kind` in the `Reference`-building literal directly after its `modality` line.

- [ ] **Step 1: Write the failing metadata tests**

Append one block per file (factory call must match the file's existing test setup — copy the config argument from an existing test in the same file):

`packages/provider-unsplash/src/__tests__/unsplash.test.ts`:

```ts
it('declares kinds and description', () => {
  const p = unsplash({ accessKey: 'k' })
  expect(p.kinds).toEqual(['photo'])
  expect(p.description).toMatch(/photo/i)
})
```

`packages/provider-pexels/src/__tests__/pexels.test.ts` (file already imports `pexels, pexelsVideo`):

```ts
it('declares kinds and description (image + video factories)', () => {
  expect(pexels({ apiKey: 'k' }).kinds).toEqual(['photo'])
  expect(pexelsVideo({ apiKey: 'k' }).kinds).toEqual(['film'])
})
```

`packages/provider-pixabay/src/__tests__/pixabay.test.ts` (file already imports `pixabay, pixabayVideo`):

```ts
it('declares kinds and description (image + video factories)', () => {
  expect(pixabay({ key: 'k' }).kinds).toEqual(['photo', 'illustration', 'vector'])
  expect(pixabayVideo({ key: 'k' }).kinds).toEqual(['film', 'animation'])
})

it('maps the upstream hit type to Reference.kind', async () => {
  const hit = {
    id: 1, tags: 'x', user: 'u', pageURL: 'https://pixabay.com/p/1',
    previewURL: 'https://cdn/p.jpg', previewWidth: 10, previewHeight: 10,
    webformatURL: 'https://cdn/w.jpg', largeImageURL: 'https://cdn/l.jpg',
    imageWidth: 100, imageHeight: 100, type: 'vectors/svg',
  }
  const fakeFetch = (async () => new Response(JSON.stringify({ hits: [hit] }), { status: 200 })) as typeof fetch
  const refs = await pixabay({ key: 'k' }).search({ text: 'x', modalities: ['image'] }, { fetch: fakeFetch })
  expect(refs[0].kind).toBe('vector')
})
```

`packages/provider-flickr/src/__tests__/flickr.test.ts`:

```ts
it('declares kinds and description', () => {
  const p = flickr({ apiKey: 'k' })
  expect(p.kinds).toEqual(['photo'])
  expect(p.description).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/provider-unsplash packages/provider-pexels packages/provider-pixabay packages/provider-flickr`
Expected: new tests FAIL (`kinds` undefined).

- [ ] **Step 3: Implement**

Factory declarations (insert after each `modalities:` line):

| File / factory | insert |
|---|---|
| unsplash (line 61) | `kinds: ['photo'],` · `description: 'High-quality free stock photography (Unsplash)',` |
| pexels image (72) | `kinds: ['photo'],` · `description: 'Free stock photos (Pexels)',` |
| pexels video (132) | `kinds: ['film'],` · `description: 'Free stock videos (Pexels)',` |
| pixabay image (100) | `kinds: ['photo', 'illustration', 'vector'],` · `description: 'Free stock photos, illustrations and vectors (Pixabay)',` |
| pixabay video (183) | `kinds: ['film', 'animation'],` · `description: 'Free stock videos and animations (Pixabay)',` |
| flickr (182) | `kinds: ['photo'],` · `description: 'Community photography with per-item CC licensing (Flickr)',` |

Result annotation (insert after each `modality:` line in the Reference literal):

- unsplash (45), pexels image (56), flickr (165): `kind: 'photo',`
- pexels video (115): `kind: 'film',`
- pixabay video (165): no annotation (multi-kind, no per-item type data — spec).
- pixabay image (84): per-item mapping. Add `type?: string` to `PixabayHit`, add above `toReference`:

```ts
// Upstream image `type` values: 'photo' | 'illustration' | 'vectors/svg'.
function pixabayKind(t: string | undefined): string | undefined {
  if (t === 'photo' || t === 'illustration') return t
  if (t === 'vectors/svg' || t === 'vector/svg') return 'vector'
  return undefined
}
```

and in the image `toReference` literal after `modality: 'image',`:

```ts
    ...(pixabayKind(h.type) ? { kind: pixabayKind(h.type) } : {}),
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/provider-unsplash packages/provider-pexels packages/provider-pixabay packages/provider-flickr`
Expected: PASS (existing fixture tests keep passing — `kind` is additive).

- [ ] **Step 5: Commit**

```bash
git add packages/provider-unsplash packages/provider-pexels packages/provider-pixabay packages/provider-flickr
git commit -m "feat(providers): kinds/description declarations for photo/stock providers"
```

---

### Task 8: provider declarations — museum/heritage group

**Files:**
- Modify: `packages/provider-met/src/index.ts` (factory 72, modality 56)
- Modify: `packages/provider-artic/src/index.ts` (factory 73, modality 46)
- Modify: `packages/provider-rijksmuseum/src/index.ts` (factory 140, modality 120)
- Modify: `packages/provider-smithsonian/src/index.ts` (factory 70, modality 54)
- Modify: `packages/provider-europeana/src/index.ts` (factory 99, modality 83)
- Test: each package's main test file

- [ ] **Step 1: Write the failing metadata tests**

Append to each of `met.test.ts`, `artic.test.ts`, `rijksmuseum.test.ts`, `smithsonian.test.ts`, `europeana.test.ts` this block, substituting the factory call per file — `met()`, `artic()`, `rijksmuseum()`, `smithsonian({ apiKey: 'k' })`, `europeana({ apiKey: 'k' })` (verified against each file's existing imports):

```ts
it('declares kinds and description', () => {
  const p = met() // ← per-file factory call from the list above
  expect(p.kinds).toEqual(['artwork'])
  expect(p.description).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/provider-met packages/provider-artic packages/provider-rijksmuseum packages/provider-smithsonian packages/provider-europeana`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

All five factories get `kinds: ['artwork'],` after `modalities:`, plus:

| Factory | description |
|---|---|
| met | `'Open Access artworks from the Metropolitan Museum of Art'` |
| artic | `'CC0 artworks from the Art Institute of Chicago'` |
| rijksmuseum | `'Rijksmuseum collection artworks, incl. the Dutch Golden Age'` |
| smithsonian | `'Open Access objects from Smithsonian museums'` |
| europeana | `'European cultural heritage from museums, libraries and archives (Europeana)'` |

All five Reference literals get `kind: 'artwork',` after `modality: 'image',`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/provider-met packages/provider-artic packages/provider-rijksmuseum packages/provider-smithsonian packages/provider-europeana`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-met packages/provider-artic packages/provider-rijksmuseum packages/provider-smithsonian packages/provider-europeana
git commit -m "feat(providers): artwork kind declarations for museum/heritage providers"
```

---

### Task 9: provider declarations — audio/text group

**Files:**
- Modify: `packages/provider-freesound/src/index.ts` (factory 96, modality 81)
- Modify: `packages/provider-jamendo/src/index.ts` (factory 94, modality 77)
- Modify: `packages/provider-openverse/src/index.ts` (audio factory 225 only; image factory 154 gets description only, Task 10)
- Modify: `packages/provider-gutendex/src/index.ts` (factory 82, modality 64)
- Modify: `packages/provider-poetrydb/src/index.ts` (factory 109, modality 32)
- Modify: `packages/provider-internet-archive/src/index.ts` (factory 94, Reference literal at 79 where `modality` is a variable)
- Test: each package's main test file

- [ ] **Step 1: Write the failing metadata tests**

Same `it('declares kinds and description', …)` pattern as Task 8, one per file, with these exact factory calls and expectations (all names verified against each file's existing imports; the openverse block goes in `openverse.test.ts` which already imports `openverseAudio`):

```ts
expect(freesound({ apiKey: 'k' }).kinds).toEqual(['sound-effect'])
expect(jamendo({ clientId: 'cid' }).kinds).toEqual(['music'])
expect(openverseAudio().kinds).toEqual(['music', 'sound-effect'])
expect(gutendex().kinds).toEqual(['ebook'])
expect(poetrydb().kinds).toEqual(['poem'])
expect(internetArchive().kinds).toEqual(['film', 'ebook'])
```

Each block also asserts `expect(p.description).toBeTruthy()`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/provider-freesound packages/provider-jamendo packages/provider-openverse packages/provider-gutendex packages/provider-poetrydb packages/provider-internet-archive`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

| Factory | kinds | description | result annotation |
|---|---|---|---|
| freesound | `['sound-effect']` | `'Collaborative archive of CC-licensed sounds (Freesound)'` | `kind: 'sound-effect',` after modality line 81 |
| jamendo | `['music']` | `'CC-licensed independent music (Jamendo)'` | `kind: 'music',` after modality line 77 |
| openverse-audio (225) | `['music', 'sound-effect']` | `'Aggregated openly licensed music and sound effects (Openverse)'` | none (multi-kind, no per-item split) |
| gutendex | `['ebook']` | `'Public-domain ebooks from Project Gutenberg (Gutendex)'` | `kind: 'ebook',` after modality line 64 |
| poetrydb | `['poem']` | `'Classic public-domain poetry (PoetryDB)'` | `kind: 'poem',` after modality line 32 |
| internet-archive | `['film', 'ebook']` | `'Public-domain and CC films and texts from the Internet Archive'` | after `modality,` at line 79: `kind: modality === 'video' ? 'film' : 'ebook',` |

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/provider-freesound packages/provider-jamendo packages/provider-openverse packages/provider-gutendex packages/provider-poetrydb packages/provider-internet-archive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-freesound packages/provider-jamendo packages/provider-openverse packages/provider-gutendex packages/provider-poetrydb packages/provider-internet-archive
git commit -m "feat(providers): kind declarations for audio and text providers"
```

---

### Task 10: provider declarations — 3D group + description-only omnibus group

**Files:**
- Modify: `packages/provider-polyhaven/src/index.ts` (polyhaven factory 82–87, `toReference` signature at ~55–80 and modality line 67; ambientcg factory 172–176, `acgToReference` modality line 159)
- Modify: `packages/provider-brave/src/index.ts` (factory 61 — description only)
- Modify: `packages/provider-wikimedia-commons/src/index.ts` (factory 145 — description only)
- Modify: `packages/provider-openverse/src/index.ts` (image factory 154 — description only)
- Test: `polyhaven.test.ts`, `ambientcg.test.ts`, `brave.test.ts`, `wikimedia-commons.test.ts`, `openverse.test.ts`

- [ ] **Step 1: Write the failing metadata tests**

`packages/provider-polyhaven/src/__tests__/polyhaven.test.ts`:

```ts
it('declares kinds per assetType', () => {
  expect(polyhaven().kinds).toEqual(['texture'])
  expect(polyhaven({ assetType: 'hdris' }).kinds).toEqual(['hdri'])
})
```

`packages/provider-polyhaven/src/__tests__/ambientcg.test.ts`:

```ts
it('declares kinds and description', () => {
  expect(ambientcg().kinds).toEqual(['texture'])
  expect(ambientcg().description).toMatch(/texture|material/i)
})
```

`brave.test.ts` / `wikimedia-commons.test.ts` / `openverse.test.ts` — same block with the per-file factory call: `brave({ token: 'SECRET' })`, `wikimediaCommons()`, `openverse()` (verified against each file's existing imports):

```ts
it('declares a description but no kinds (omnibus source)', () => {
  const p = brave({ token: 'SECRET' }) // ← per-file factory call from the list above
  expect(p.kinds).toBeUndefined()
  expect(p.description).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/provider-polyhaven packages/provider-brave packages/provider-wikimedia-commons packages/provider-openverse`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

polyhaven factory (inside `export function polyhaven`, after `modalities: ['image'],` at line 86 — `assetType` is already in scope at line 83):

```ts
    kinds: assetType === 'hdris' ? ['hdri'] : ['texture'],
    description: assetType === 'hdris'
      ? 'CC0 HDRI environments for 3D lighting (Poly Haven)'
      : 'CC0 PBR textures for 3D work (Poly Haven)',
```

polyhaven result annotation: `toReference(id, asset, imageUrl)` is module-level
while `assetType` lives in the factory closure — add a fourth parameter
`kind: string` to `toReference`, insert `kind,` after `modality: 'image',`
(line 67), and update the call at line 115 to
`toReference(id, asset, imageUrl, assetType === 'hdris' ? 'hdri' : 'texture')`.

ambientcg factory (after `modalities: ['image'],` at line 175):

```ts
    kinds: ['texture'],
    description: 'CC0 PBR materials and textures (ambientCG)',
```

ambientcg result annotation: `kind: 'texture',` after `modality: 'image',` at line 159.

Description-only (no `kinds`, after each `modalities:` line):

| Factory | description |
|---|---|
| brave (61) | `'Open-web image search (Brave)'` |
| wikimedia-commons (145) | `'Freely licensed media from the Wikimedia Commons archive'` |
| openverse image (154) | `'Aggregated openly licensed images from many sources (Openverse)'` |

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/provider-polyhaven packages/provider-brave packages/provider-wikimedia-commons packages/provider-openverse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-polyhaven packages/provider-brave packages/provider-wikimedia-commons packages/provider-openverse
git commit -m "feat(providers): 3D kind declarations and omnibus descriptions"
```

---

### Task 11: changeset + full verification

**Files:**
- Create: `.changeset/provider-resource-declaration.md`

- [ ] **Step 1: Confirm exact package names**

Run: `grep -h '"name"' packages/*/package.json`
Use the exact names below (adjust if any differ).

- [ ] **Step 2: Write the changeset**

Create `.changeset/provider-resource-declaration.md`:

```md
---
'@refkit/core': minor
'@refkit/mcp': minor
'@refkit/provider-testkit': minor
'@refkit/provider-unsplash': minor
'@refkit/provider-pexels': minor
'@refkit/provider-pixabay': minor
'@refkit/provider-flickr': minor
'@refkit/provider-brave': minor
'@refkit/provider-wikimedia-commons': minor
'@refkit/provider-openverse': minor
'@refkit/provider-met': minor
'@refkit/provider-artic': minor
'@refkit/provider-rijksmuseum': minor
'@refkit/provider-smithsonian': minor
'@refkit/provider-europeana': minor
'@refkit/provider-freesound': minor
'@refkit/provider-jamendo': minor
'@refkit/provider-gutendex': minor
'@refkit/provider-poetrydb': minor
'@refkit/provider-internet-archive': minor
'@refkit/provider-polyhaven': minor
---

Provider resource declarations: open `ResourceKind` vocabulary with optional
`kinds` + `description` on providers and `kind` on references; kind-aware
routing and a `providers` id whitelist with new skip reasons
(`unsupported-kind`, `not-selected`); MCP tool schema, source list, and enums
now derived from registered provider declarations at startup.
```

- [ ] **Step 3: Full verification**

Run, in order, and require success for each:

```bash
pnpm typecheck
pnpm test:run
pnpm build
git diff --check
```

Expected: all pass. If `pnpm typecheck` / `test:run` / `build` scripts do not exist at the root, use the equivalents in the root `package.json` scripts section.

- [ ] **Step 4: Commit**

```bash
git add .changeset/provider-resource-declaration.md
git commit -m "chore: changeset for provider resource declarations"
```
