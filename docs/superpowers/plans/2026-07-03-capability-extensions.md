# Wave 4 — Capability Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans, task-by-task.

**Goal:** (4a) export a programmable low-level `evaluatePermissions` with `evaluateUse` refactored into behavior-identical presets; (4b) document pagination semantics; (4c) stateless `evaluate_use` + `build_attribution` MCP tools and unified `REFKIT_<PROVIDER>_KEY` env names with legacy fallbacks; (4d) a runnable semantic-rerank cookbook. Branch: `m13t/wave4-capability-extensions` (off main).

**Hard constraint for 4a:** ALL existing evaluate-use tests pass UNCHANGED — the refactor is proven behavior-identical by the existing suite (reason strings included).

---

### Task W4.1: core — `evaluatePermissions` (4a)

**Files:** modify `packages/core/src/evaluate-use.ts`, `packages/core/src/index.ts`; test `packages/core/src/__tests__/evaluate-use.test.ts` (ADD only).

Design (implementer adapts internals so existing tests stay green verbatim):

```ts
/** The tri-state permission axes of LicenseFacts. */
export type PermissionKey = 'commercialUse' | 'derivatives' | 'redistribution'

export interface EvaluateOptions {
  /** Treat editorial-only sources as denied (commercial-flavored uses). Default false. */
  denyEditorialOnly?: boolean
  /** Enforce attributionRequired as allowed-with-attribution. Default true; presets
   *  disable it for internal-moodboard (note-only). */
  enforceAttribution?: boolean
}

/** Low-level, programmable strict-deny gate: unknown license → needs-review;
 *  jurisdiction mismatch → needs-review; each required permission false → denied,
 *  'unknown' → needs-review; else allowed(-with-attribution). evaluateUse's four
 *  intents are presets over this. */
export function evaluatePermissions(
  r: RightsRecord,
  required: readonly PermissionKey[],
  ctx?: { userJurisdiction?: string },
  opts?: EvaluateOptions,
): Verdict
```

`evaluateUse` becomes: map intent → (required, opts) preset and delegate; keep the moodboard "attribution required by license but not enforced" reason note and every existing reason string byte-identical (existing tests are the oracle). Export `evaluatePermissions`, `PermissionKey`, `EvaluateOptions` from core index. New tests (ADD): custom permission set `['derivatives']` on CC-BY-ND → denied naming CC-BY-ND; empty required on CC-BY with enforceAttribution true → allowed-with-attribution; unknown license → needs-review regardless of required; parity spot-check `evaluatePermissions(rec, ['commercialUse'], undefined, {denyEditorialOnly:true})` equals `evaluateUse(rec,'commercial-product')` for a few licenses. Changeset: `.changeset/evaluate-permissions.md` — `"@refkit/core": minor` — "Export evaluatePermissions/PermissionKey/EvaluateOptions — programmable strict-deny gate; evaluateUse intents are now presets over it (behavior unchanged)." Verify: full repo green (304/22). Commit `feat(core): programmable evaluatePermissions; evaluateUse intents become presets`.

### Task W4.2: MCP — stateless verdict tools + env unification (4c)

**Files:** modify `packages/mcp/src/index.ts`, `packages/mcp/src/cli.ts`, `packages/mcp/src/__tests__/mcp.test.ts`, `packages/mcp/README.md` (if it documents env vars — check), changeset.

1. Register two tools in `createRefkitMcpServer` (stateless — inputs carry the rights fields; no session cache):
   - `evaluate_use`: input { license: z.enum(LICENSE_IDS from core), licenseVersion?, author?, title?, canonicalUrl: string, intent: z.enum(INTENTS), editorialOnly?: boolean, jurisdiction?: string, userJurisdiction?: string }. Build a RightsRecord (rehostPolicy 'cache-allowed', raw { sourceTerms: '', sourceUrl: canonicalUrl } — verdict doesn't read them), call core `evaluateUse(rights, intent, { userJurisdiction })`; output { decision, reasons, confidence, disclaimer, attribution? (text when verdict allows-with-attribution — via buildAttribution) }. Description: mirrors search_references' "not legal advice" framing.
   - `build_attribution`: input { license, licenseVersion?, author?, title?, canonicalUrl } → core buildAttribution output { required, text?, html? }.
2. cli.ts `defaultProviders`: unified names first with legacy fallback — `REFKIT_UNSPLASH_KEY ?? UNSPLASH_KEY`, `REFKIT_PEXELS_KEY ?? PEXELS_KEY`, `REFKIT_PIXABAY_KEY ?? PIXABAY_KEY`, `REFKIT_FLICKR_KEY ?? FLICKR_KEY`, `REFKIT_SMITHSONIAN_KEY ?? SI_KEY`, `REFKIT_BRAVE_KEY ?? BRAVE_TOKEN`, `REFKIT_FREESOUND_KEY ?? FREESOUND_TOKEN`, `REFKIT_JAMENDO_CLIENT_ID ?? JAMENDO_CLIENT_ID`, `REFKIT_EUROPEANA_KEY ?? EUROPEANA_KEY`. Comment documents the convention; `defaultProviders` is already unit-tested — extend its tests to cover a REFKIT_-name and a legacy-name both working.
3. Tests: tool-level tests for both new tools (CC-BY → allowed-with-attribution + credit line; unknown → needs-review; CC0 → attribution not required). Follow mcp.test.ts's existing server-invocation pattern.
4. Changeset `"@refkit/mcp": minor`: new tools + env aliases (legacy names still honored).
5. Root README MCP section: mention the two new tools in one sentence; keep the env example working.

Verify: full repo green. Commit `feat(mcp): stateless evaluate_use + build_attribution tools; REFKIT_* env aliases`.

### Task W4.3: docs — pagination semantics + rerank cookbook (4b, 4d)

**Files:** modify `packages/core/src/provider.ts` (SearchControls.page JSDoc), root `README.md` (Search controls section), create `docs/examples/semantic-rerank.md`.

1. `SearchControls.page` JSDoc: `/** Provider-local page cursor: each provider paginates its own result stream; after RRF merging, page N+1 may overlap or shift relative to page N. For UI "load more", dedupe across pages by canonicalUrl (see README). */` README Search controls section: 3-sentence paragraph stating the same + a dedupe recipe snippet (`const seen = new Set(prev.map(r => r.canonicalUrl))` filter).
2. `docs/examples/semantic-rerank.md`: runnable BYO-embedding `Reranker` — fetch embeddings from a host-provided endpoint for `[query, ...refs.map(title+excerpt)]`, cosine similarity, sort desc, rewrite relevance to normalized score, note on preserving referenceSchema invariants (0..1, no mutation — copy refs), and a one-line pointer that lexicalReranker remains the zero-dep default. TypeScript, imports from '@refkit/core' only, ~60 lines, self-contained.

No changeset (docs only). Verify repo green. Commit `docs: pagination semantics + semantic-rerank cookbook`.

---

**Wave finish (coordinator):** final whole-wave review → push → PR to main. Changesets: core minor + mcp minor land in Tasks 1–2.
