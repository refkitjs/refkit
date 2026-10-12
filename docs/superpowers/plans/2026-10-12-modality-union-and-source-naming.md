# Reference by Modality and Source Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Reference` a union keyed by modality, with audio and video metadata. Give the catalog a search queries one name: "source". Fix the defects found in the same files.

**Spec:** `docs/superpowers/specs/2026-10-12-modality-union-and-source-naming-design.md`. Sections D1–D7 are binding. D8, the dsh plugin, is a separate follow-up after the refkit packages are on npm.

**Tech stack:** TypeScript strict, a pnpm workspace, vitest (`pnpm test:run`), zod 4, tsup.

## Global Constraints

- `@refkit/core` depends only on `zod`. No `fetch(` call and no `http(s)://` literal in `packages/core/src`; `no-network.test.ts` enforces this.
- Every `@refkit/provider-*` package depends only on `@refkit/core`.
- No compatibility shims and no deprecated aliases. Renamed surfaces are renamed everywhere in this repo.
- Each task ends green: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:run && pnpm smoke:artifact`.
- Write tests first where behaviour changes, and show RED before GREEN in the report.
- Commits use conventional prefixes, with no attribution or Co-authored-by trailers. Never `git stash`. Never push. Work only in /Users/xuan/Desktop/testSpace/refkit/.claude/worktrees/jolly-heyrovsky-787cc1 on branch `feat/modality-union-source-naming`.
- Implementers do not dispatch subagents.
- Changesets are written in Task 4 only.

---

### Task 1: core union, schemas, modality boundary, testkit (spec D1, D2, D3, D6.2 core and testkit, D6.7)

**Files:** `packages/core/src/reference.ts`, `packages/core/src/index.ts`, `packages/core/src/provider-run.ts` (cache key, modality rejection), `packages/core/src/rerank.ts` / `confidence.ts` / `dedup.ts` (only if needed to compile), `packages/provider-testkit/src/index.ts`, plus tests in `packages/core/src/__tests__/` and the testkit's tests.

- [ ] **Step 1.** Type tests first, in a `reference-types.test.ts` using `expectTypeOf` and `@ts-expect-error`:
  - each `Emitted…` variant rejects another variant's field (`visual` on text, `text` on image, `audio` on video, and so on);
  - `completeReference` returns a `Reference` whose `modality` still narrows to the right variant.
- [ ] **Step 2.** Implement D1/D2 in `reference.ts`:
  - the variant interfaces, with the other variants' fields typed `?: never`;
  - `VideoMeta` and `AudioMeta`;
  - `EmittedReference` and `Reference` as union aliases;
  - `completeReference` keeps the discriminant.
  
  Export the new types from `index.ts`, and document `thumbnail` as "an image a UI can show". Retype the fixture builders that spread `Partial<Reference>`/`Partial<EmittedReference>` over an image default (`client.test.ts:1059`, `confidence.test.ts:7`, `dedup.test.ts:5`, `rerank.test.ts:6`, testkit `testkit.test.ts:7`) to `Partial<ImageReference>`/`Partial<EmittedImageReference>`.
- [ ] **Step 3.** Schema tests first, then implement D3:
  - `z.discriminatedUnion('modality', …)` built from one `satisfies Record<Modality, z.ZodRawShape>` table through a generic `variant(m, tail)` helper called once per modality in an explicit tuple, plus a type test that `EmittedReference['modality']` is exactly `Modality`;
  - a per-variant `preview.mediaType` prefix check;
  - cross-modality keys stripped.
  
  Keep `emittedReferenceSchema: z.ZodType<EmittedReference>` and `referenceSchema: z.ZodType<Reference>` assignable.
- [ ] **Step 4.** Cache key `refkit:v3` → `refkit:v4` in `provider-run.ts`, with a test (spec D3 explains why it is required).
- [ ] **Step 5.** D6.2, core side, exactly as the spec words it. In `runProviderSearch`'s live path, an emitted item whose `modality` is not in `query.modalities` (the per-source normalized list, `SearchInput.modalities ∩ provider.modalities`) is counted as **rejected** on the existing malformed-item path: counted in `rejected` and firing the error callback. Update the `rejected` doc comment. Test a provider declaring `['image']` that emits `video` while the caller asks for `['image','video']`.
- [ ] **Step 6.** Testkit (spec D6.7, D3):
  - drop the testkit's own preview `mediaType` check, which the schema now enforces; `testkit.test.ts:63-67` expects the `failed emittedReferenceSchema` message;
  - run the thumbnail landing-page rule per item for every modality;
  - assert `ref.modality ∈ provider.modalities`;
  - assert `parseEmitted(item)` lost no keys: top-level keys and the keys of nested known objects, skipping `raw`.
  
  Run every provider package's tests. A failure that is a real provider defect is reported, not hidden; fix it only if it belongs to this task, otherwise note it for Task 3.
- [ ] **Step 7.** Gate, then commit `feat(core)!: Reference is a union keyed by modality, with audio and video metadata`.

### Task 2: one name for "source" (spec D4, D6.3 core, D6.4, D6.6; MCP renames from D7)

**Files:**
- core: `client.ts`, `select.ts`, `schemas.ts`, `pipeline.ts`, `provider-run.ts`, `provider.ts`, `reference.ts`, `dedup-key.ts`, `index.ts`, `rerank.ts`;
- `packages/core/README.md`, adding the two-line glossary from D4;
- `packages/mcp/src/index.ts` and `cli.ts` where needed;
- every test that reads a renamed surface;
- provider tests only where they read renamed core surfaces.

- [ ] **Step 1.** Rename exactly per the D4 table: old name → new name, including `PassDeps.providerOptions` and `normalizeQuery`'s `providerOptions` input, and every message string. Keep everything D4 lists as "unchanged" (`NormalizedQuery.providerOptions`, `PassDeps.providers`, `ProviderSelection`, `providerCacheKey`, `ProviderRun`, `ProviderRunDeps`, and the rest). Grep the repo afterwards, including READMEs, docstrings and `scripts/` (e.g. `scripts/build-hero.mts`), for each old identifier and paste the result in the report. Hits are allowed only in CHANGELOG.md files and docs/superpowers.
- [ ] **Step 2.** D6.4, tests first. Export `SourceSelectionError extends Error` with `code: 'no-matching-source' | 'no-source-for-query'` and the fields `requested?`, `unknown`, `modalities` and `kind?`, exactly as spec D6.4 defines them. Throw it from both selection throws, and test each case the spec lists: unknown id, known id without the modality, kind miss, `sources: []`, and no source for the query. MCP's tool-error path detects it with `instanceof` and `code === 'no-matching-source'`, not by inspecting the message; other errors raised while `sources` is set now throw.
- [ ] **Step 3.** D6.3, core side, tests first. `createRefkit` throws on duplicate provider ids, and the message names the id. Check the MCP CLI's default provider list and every test fixture for duplicates.
- [ ] **Step 4.** D6.6, tests first. Unknown ids in `sourceOptions` produce a warning in `meta.warnings`, worded like the existing unknown-`sources` warning.
- [ ] **Step 5.** MCP renames from D7: input `sourceOptions`, agent ref `source`. Update the MCP tests and the MCP README lines that name these.
- [ ] **Step 6.** Gate, then commit `feat(core)!: one name for the catalog a search queries — source`.

### Task 3: providers — metadata, defects (spec D5, D6.1, D6.2 IA, D6.3 polyhaven, D6.5, D6.8)

**Files:** `packages/provider-{openverse,freesound,jamendo,pexels,pixabay,internet-archive,polyhaven,flickr}/src/index.ts` and their tests and fixtures.

- [ ] **Step 1.** D5, with a fixture test first for each field.
  - openverse-audio: `audio.durationSec` (ms/1000), `bitrateKbps` (bps/1000, null for Jamendo-sourced items), `sampleRateHz` (often null), and `format` only when `filetype` is a key of `AUDIO_MIME`, with `mp31`/`mp32` normalised to `mp3`.
  - freesound: `audio.durationSec`.
  - jamendo: `audio.durationSec`. Confirm the field from the fixture or the vendor docs, and add it to the typed interface.
  - pexels-video and pixabay-video: `video.durationSec`.
  - Null or non-finite values leave the field unset.
- [ ] **Step 2.** D6.1. openverse-audio's `thumbnail` comes from the upstream `thumbnail` (album art), unset when null; the waveform URL is dropped. Update the fixture test that pins `waveform`.
- [ ] **Step 3.** D6.5.
  - pixabay-video: `kind` from the upstream `type` (`film` / `animation`), unset otherwise.
  - openverse-audio: `kind` from `category`. First verify live (keyless): `curl 'https://api.openverse.org/v1/audio/?q=rain&page_size=5'` and `?q=piano`. Map only values that clearly mean music or sound effect, and paste the observed values. Expect only `music` for Jamendo-sourced items and `null` for Freesound-sourced ones. If Openverse is unreachable from this network (DNS has returned wrong addresses before), say so, and rely on the fixture and the spec reviewer's live observation.
- [ ] **Step 4.** D6.2 for Internet Archive. Derive the `mediatype:` filter from the requested modalities (video → movies, text → texts), and return `[]` without a request when neither is requested. The query-escaping test's expected clause (`internet-archive.test.ts:194-198`) changes to `mediatype:(movies)` for a video-only query. Verify live (keyless) that a text-only query returns no movies.
- [ ] **Step 5.** D6.3. `polyhaven({ assetType: 'hdris' })` uses the id `polyhaven-hdri`. Update its tests and README, and grep the repo for the old assumption.
- [ ] **Step 6.** D6.8. Flickr and pixabay-video stop setting `visual` from a rendition; the rendition size stays on `preview`. Update the pins `flickr.test.ts:59` and `pixabay.test.ts:134`. pixabay-video skips a rendition whose `url` is empty or whose size is 0 when choosing the preview, and gets a test.
- [ ] **Step 7.** `REFKIT_LIVE=1 pnpm test:live` once, then the gate. Paste the live summary: a 403 WAF skip is fine, and keyed sources skip without keys. Commit `feat(providers): audio and video durations, honest thumbnails and kinds, no modality leaks`.

### Task 4: MCP fields, docs, changesets (spec D7 additive part, release notes)

- [ ] **Step 1.** Test first. The MCP agent ref gains optional `durationSec` (from `audio`/`video`) and `width`/`height` (from `visual`, else from `preview.width/height`), and the output schema describes them.
- [ ] **Step 2.** Docs:
  - root README and core README: the variants table and the glossary;
  - the MCP README output line;
  - the provider READMEs whose output changed (openverse, polyhaven).
  
  Remove stale names.
- [ ] **Step 3.** One changeset (spec, Release line) listing `@refkit/core`, `@refkit/mcp` and **all 19** `@refkit/provider-*` packages as **minor**; `@refkit/provider-testkit` is private and needs none. It says in plain words:
  - what changed: the union and its type-alias consequences, every D4 rename, the D5 fields and the D6 fixes;
  - how to migrate;
  - that `polyhaven-hdri` is breaking for HDRI users;
  - that `visual` now means the original's size.
- [ ] **Step 4.** Gate, then commit `feat(mcp): duration and dimensions for agents; docs and changesets for the source/modality release`.

---

## After the plan

1. Final whole-branch review. Rebase onto main once #33 is merged, then open the PR. The user merges it, and later merges the Version Packages PR.
2. Follow-up D8 in the dsh-plugin repo, with its own brief, after the new packages are on npm.
