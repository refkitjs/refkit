# Phase 5+ P1 Providers — Index & Shared Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each per-provider plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the remaining roadmap §3 P1 provider satellites to refkit, each as an independent `@refkit/provider-*` package that returns license-normalized `Reference`s.

**Architecture:** Every provider is a thin satellite depending only on `@refkit/core`. It exposes one factory function returning `defineProvider({ id, modalities, queryFeatures, capabilities, search })`. `search` fetches the source API via `ctx.fetch`, maps each item's source-declared license to a `LicenseId` (+ optional `licenseVersion`), and emits `Reference`s through a `toReference` mapper. Permissions are never stored — they derive from `license` via core's `factsFor()`/`evaluateUse()`. This index defines the boilerplate skeleton and cross-cutting decisions shared by all six per-provider plans; read it first.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), tsup (build), vitest (test), zod (via core), pnpm workspaces, changesets.

---

## Provider set & sequencing

Build in this order (cheapest/cleanest first; each is an independent package → parallelizable via worktree-isolated subagents):

| # | Plan file | Package | Modality | Auth | License source | Effort |
|---|---|---|---|---|---|---|
| 1 | `2026-06-29-provider-rijksmuseum.md` | `@refkit/provider-rijksmuseum` | image (art) | keyless (modern `data.rijksmuseum.nl`, N+1) | per-item CC0/PD rights URI | M |
| 2 | `2026-06-29-provider-polyhaven.md` | `@refkit/provider-polyhaven` | image (texture/HDRI) | keyless | whole-source CC0 (hardcoded ToS) | S |
| 3 | `2026-06-29-provider-freesound.md` | `@refkit/provider-freesound` | audio (SFX) | BYOK (token) | per-item CC name string | M |
| 4 | `2026-06-29-provider-jamendo.md` | `@refkit/provider-jamendo` | audio (music) | BYOK (client_id) | per-item `license_ccurl` | M |
| 5 | `2026-06-29-provider-europeana.md` | `@refkit/provider-europeana` | image/mixed | BYOK (free key) | per-item `edm:rights` vocab | L |
| 6 | `2026-06-29-provider-internet-archive.md` | `@refkit/provider-internet-archive` | video / text | keyless | dirty per-item `licenseurl` | M–L |

ambientcg is folded into the poly-haven plan as a sibling factory (`ambientcg()`) — same whole-source-CC0 shape, different endpoint.

> **Parallelization caveat:** the per-package work (new `packages/provider-<id>/` dir + `src/` + tests, Tasks 1–N of each plan) is fully independent and parallelizable via worktree-isolated subagents. But the **Shared Task S9 central-wiring steps touch five shared files** — `packages/mcp/src/cli.ts`, `packages/mcp/src/__tests__/mcp.test.ts`, root `README.md`, root `vitest.config.ts`, and `packages/mcp/package.json` (S9.5). If you build providers in parallel, **defer S9 and run all the central wiring in a single serialized integration pass** at the end (one commit per provider is fine, but edit the shared files sequentially), or you will get merge conflicts. S9.1–S9.6 are append-only edits, so a serial pass is quick.

---

## Cross-cutting design decisions (lock these before coding)

These resolve the roadmap §3 caveats. They follow refkit's existing conventions (see `provider-met`, `provider-flickr`, `evaluate-use.ts`): **conservative, per-item, strict-deny; anything not clearly granted → `unknown` → `needs-review`. Never fabricate a license.**

- **D1 — Modality ceiling (affects poly-haven):** `core/src/modality.ts` defines exactly `image | video | audio | text`; `referenceSchema` enforces it. There is **no `3d`/`texture` modality**. Decision: map textures and HDRIs as `modality: 'image'` (they are image files); **skip 3D model formats (.blend/.fbx/.gltf) for v1** (YAGNI — no core change). Document the skip in the README. Adding a `3d` modality is explicitly out of scope for Phase 5.
- **D2 — Whole-source CC0 hardcode (poly-haven, ambientcg):** no per-item license field exists; hardcode `license: 'CC0-1.0'`, `rights.raw.sourceTerms = <license/ToS URL>`. Mirror `provider-met`'s hardcoded-CC0 shape exactly.
- **D3 — Dirty license (internet-archive):** map an item only when it carries a parseable `licenseurl`/`rights`; **every item without one → `license: 'unknown'`** (core turns it into `needs-review`). Do not drop them silently and do not guess PD.
- **D4 — License name-string mapping (freesound):** freesound returns a CC name/short string (e.g. `"Attribution"`, `"Creative Commons 0"`), not a URL or version. Map the name → family `LicenseId`; **omit `licenseVersion`** (no reliable version). Unrecognized name → `unknown`.
- **D5 — Partial enum fit (jamendo):** jamendo `license_ccurl` → match the URL to a family: CC-BY → `CC-BY`, CC-BY-SA → `CC-BY-SA` (capture version from the URL when present); CC-BY-NC*/CC-BY-ND* → `proprietary`; anything unrecognized → `unknown`.
- **D6 — Hotlinked media (europeana):** media bytes are third-party-hosted; set `rights.rehostPolicy: 'hotlink-required'` (not `cache-allowed`). Map `edm:rights` controlled-vocab URIs per D5-style URL matching: CC deeds → CC family (via `mapCcDeedUrl`); **rightsstatements.org → faithful per-token mapping** (via the shared `mapRightsUrl`): In-Copyright `InC*` → `proprietary`; `NoC-US` → `PD` + `jurisdiction:'US'` (jurisdiction-scoped); `NoC-NC` → `proprietary`; opaque/undetermined (`NoC-OKLR`/`NoC-CR`/`CNE`/`UND`/`NKC`) → `unknown`. rightsstatements are rights-STATUS statements, not grants — map them to the closest TRUE representation rather than discarding the source's signal as blanket `unknown` (that would be lossy, not "faithful"); but never *guess* PD where the source said nothing. Same `mapRightsUrl` used by internet-archive's `licenseurl`.
- **D7 — License version from a CC URL:** when a CC deed URL is available, extract the version with `/\/licenses\/by(?:-sa)?\/(\d\.\d)\//` and set `licenseVersion` only for `CC-BY`/`CC-BY-SA` families. (This is the same *version-guard* convention as `provider-openverse`/`provider-flickr` — `licenseVersion` lives only on the BY/BY-SA families — but the *extraction mechanism* differs by source: openverse reads a structured `license_version` field and flickr maps a numeric license id, neither parses the version out of a URL by regex.)
- **D8 — `preview.url`/`thumbnail.url` must be an image resource, never a web page.** Some sources expose a *viewer/landing page* URL alongside (or instead of) the real image — Rijksmuseum Linked-Art `access_point`s, Europeana `edmIsShownAt`. We do **not** know from a URL string alone whether it's an image, and a network probe is out of scope (`core` never fetches bytes; an extra request per item is too costly). So: **(1) read the type the API gives** — a MIME field (`format`, `ebucoreHasMimeType`) or the media-vs-page semantic distinction (`edmIsShownBy` vs `edmIsShownAt`); **(2) cheap URL-string heuristic fallback** (image extension / `iiif` / IIIF request path / known image CDN / `/thumbnail/`); **(3) degrade** — if no image-like URL qualifies, omit `preview` (fall back to a known-image thumbnail if any), and for an image-only provider drop the item rather than surface a page. Never put a page URL in `preview.url`. Do **not** add an npm image-detection dependency (`file-type`/`image-type` need the bytes; `is-image-url` is just an extension check) — a one-line heuristic + reading the response type covers it with zero deps. Applies to: rijksmuseum, europeana (and any future image provider whose API mixes media and page URLs).

Each per-provider plan's first task is a 1-line checkbox confirming which decisions apply.

---

## Shared Task S0 — Provider satellite skeleton (every plan starts here)

Each per-provider plan references this task with its own substitution row, then adds only the `src/index.ts` mapper/search and the test. Substitute throughout:

- `<id>` — provider id / dir suffix, e.g. `rijksmuseum` (used in `provider-<id>`, `referenceId('<id>', …)`, the provider `id`).
- `<Fn>` — exported factory name, e.g. `rijksmuseum`.
- `<Title>` — human name, e.g. `Rijksmuseum`.
- `<modality>` — `image` | `audio` | `video` | `text`.
- `<auth>` — `keyless` | `API key`.
- `<licenseCol>` — README license column, e.g. `per-item CC / PD`.

- [ ] **S0.1: Create the package directory and `package.json`**

Create `packages/provider-<id>/package.json` (copy of `provider-met`'s, renamed). Keywords should reflect the source:

```json
{
  "name": "@refkit/provider-<id>",
  "version": "0.1.0",
  "description": "<Title> provider satellite for refkit.",
  "type": "module",
  "license": "Apache-2.0",
  "keywords": ["refkit", "reference-retrieval", "license", "attribution", "refkit-provider", "<id>"],
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "build": "tsup",
    "prepublishOnly": "tsup"
  },
  "dependencies": { "@refkit/core": "workspace:*" },
  "files": ["dist", "LICENSE"],
  "publishConfig": {
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
  }
}
```

- [ ] **S0.2: Create `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`**

`packages/provider-<id>/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "out", "rootDir": "src", "types": ["node"] },
  "include": ["src/**/*"]
}
```

`packages/provider-<id>/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: true,
})
```

`packages/provider-<id>/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-<id>', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
```

- [ ] **S0.3: Copy `LICENSE` and write `README.md`**

```bash
cp packages/provider-met/LICENSE packages/provider-<id>/LICENSE
```

`packages/provider-<id>/README.md` (follow `provider-met`'s shape):
```markdown
# @refkit/provider-<id>

Search **<Title>** as license-tagged <modality> references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** <Title>
- **Auth:** <auth>
- **Modality:** <modality>
- **License:** <licenseCol>

## Usage

​```ts
import { createRefkit } from '@refkit/core'
import { <Fn> } from '@refkit/provider-<id>'

const refkit = createRefkit({ providers: [<Fn>(/* config */)] })
const refs = await refkit.search({ query: 'cat', modalities: ['<modality>'] })
​```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
```

- [ ] **S0.4: Install workspace deps**

Run: `pnpm install`
Expected: lockfile updates; `@refkit/provider-<id>` resolves `@refkit/core` via `workspace:*`. (No commit yet — bundle with the first real change.)

## Shared Task S9 — Central wiring (every plan ends here)

After `src/index.ts` + test are green, register the provider:

- [ ] **S9.1: Add the leaf vitest project** — in root `vitest.config.ts`, append `'./packages/provider-<id>/vitest.config.ts',` to the `projects` array.

- [ ] **S9.2: Add to the README provider table** — in `README.md` (the `| @refkit/provider-… |` table around line 156-167), add a row:
  `| `@refkit/provider-<id>` | <Title> | <modality> | <auth> | <licenseCol> |`

- [ ] **S9.3: Wire the zero-config CLI** — in `packages/mcp/src/cli.ts`:
  - add `import { <Fn> } from '@refkit/provider-<id>'`
  - **keyless** providers: add `<Fn>()` to the base `providers` array.
  - **BYOK** providers: add `if (env.<ENVVAR>) providers.push(<Fn>({ ...: env.<ENVVAR> }))` after the existing BYOK block. Pick a clear `<ENVVAR>` (e.g. `RIJKS_KEY`, `FREESOUND_TOKEN`, `JAMENDO_CLIENT_ID`, `EUROPEANA_KEY`). internet-archive is keyless.

- [ ] **S9.4: Extend the CLI wiring test** — in `packages/mcp/src/__tests__/mcp.test.ts` (`describe('defaultProviders'…)`, ~line 227):
  - keyless: add `'<id>'` to the id list asserted by `'includes every keyless provider by default'`.
  - BYOK: add an assertion mirroring the unsplash gate — id absent without env, present with `{ <ENVVAR>: 'k' }`.

- [ ] **S9.5: Add `mcp` as a devDep consumer if needed** — `mcp` already lists provider deps in `packages/mcp/package.json`; add `"@refkit/provider-<id>": "workspace:*"` there.

- [ ] **S9.6: Write a changeset** — create `.changeset/provider-<id>.md`:
```markdown
---
"@refkit/provider-<id>": minor
"@refkit/mcp": minor
---

Add @refkit/provider-<id>: <Title> as license-normalized <modality> references.
```

- [ ] **S9.7: Verify the whole repo green**

Run: `pnpm install && pnpm -r typecheck && pnpm test:run`
Expected: typecheck clean; all vitest projects (including `provider-<id>`) pass.

- [ ] **S9.8: Commit**
```bash
git add -A
git commit -m "feat(provider-<id>): <Title> satellite (P1)"
```

---

## Self-Review (run after all per-provider plans are written)

1. **Spec coverage:** all six §3 P1 rows have a plan; §3 cheap wins (openverse-audio, pexels/pixabay-video) already shipped — no plan needed.
2. **Decision coverage:** each plan's Task 1 states which of D1–D8 apply.
3. **Type consistency:** every plan emits a valid `Reference` (required: `id, modality, source{providerId,sourceUrl}, canonicalUrl, rights, verifiedAt, relevance`) and a valid `RightsRecord` (required: `license, rehostPolicy, raw{sourceTerms,sourceUrl}`); `licenseVersion` only for CC-BY/CC-BY-SA.
4. **Skip list intact:** none of these are on §4 (no Getty/Shutterstock/Kaboompics/web-search).
