# Core Hardening & Capability Waves — Index

> **For agentic workers:** This is a SEQUENCING CONTRACT, not a task plan. Each wave gets its own detailed plan doc (superpowers:writing-plans format, bite-sized TDD tasks) authored **just-in-time at wave start**, against the codebase state after prior waves merged. Execute each wave plan via superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Close the architecture-review gaps of 2026-07-03: license-family fidelity, orchestrator resilience, test infrastructure, and capability extensions — without breaking core's invariants (zero-network, strict-deny, no re-hosting).

**Architecture:** Four sequential waves, ordered by (a) file-conflict clusters — items that rewrite the same files ship together, (b) dependency — the testkit encodes Wave 1's final mapping tables, so it comes after. Tracks *within* Waves 3–4 are parallelizable via worktree-isolated subagents; anything touching `packages/core/src/client.ts` or shared wiring is serialized.

**Tech Stack:** Existing repo stack only — TypeScript ESM, tsup, vitest, zod, pnpm workspaces, changesets. No new runtime dependencies in core.

---

## File-conflict matrix (why the waves are shaped this way)

| Cluster | Files | Items |
|---|---|---|
| license engine | `core/src/license.ts`, `rights.ts`, `rerank.ts` (LICENSE_PERMISSIVENESS), `provider-helpers.ts` (mapCcDeedUrl), 5–6 provider mappers | Wave 1 |
| orchestrator | `core/src/client.ts` + `client.test.ts` + SearchMeta types | Wave 2 (timeout, retry, latency, cache — one pass, not four) |
| new packages / workflows only | `packages/provider-testkit/`, `.github/workflows/live-smoke.yml`, per-provider `live.test.ts` | Wave 3 (parallel) |
| independent seams | `evaluate-use.ts` (4a), docs (4b, 4d), `mcp/src` (4c) | Wave 4 (parallel except 4a vs anything touching evaluate-use) |

---

## Wave 1 — License-family fidelity (`CC-BY-NC*` / `CC-BY-ND`)

**Why first:** it's the moat. Current NC/ND→`proprietary` collapse has two real defects: (1) NC assets used under `internal-moodboard` get **no attribution line** (proprietary has `attributionRequired: false`, CC-BY-NC legally requires credit); (2) verdict reasons name the wrong license ("not granted by proprietary"), corrupting explainability for agents. Precedent: the §1 CC-version-axis change (`75c557e`) shipped the same shape of core-enum + mappers atomic change.

**Scope:** add four family ids to `LicenseId` + `LICENSE_FACTS` + `rightsRecordSchema` + `LICENSE_PERMISSIVENESS`; update `mapCcDeedUrl` (covers europeana + internet-archive centrally) and the provider-local mappers that hardcode NC/ND→proprietary: openverse, flickr, wikimedia-commons, freesound, jamendo. (gutendex's `proprietary` is for copyrighted books, not NC — verify, expect no change.)

**Locked decisions:**

- **H1 — Facts table rows** (Tri semantics per `license.ts`):

  | id | commercialUse | derivatives | redistribution | attributionRequired | shareAlike |
  |---|---|---|---|---|---|
  | `CC-BY-ND` | true | false | true | true | false |
  | `CC-BY-NC` | false | true | 'unknown' | true | false |
  | `CC-BY-NC-SA` | false | true | 'unknown' | true | true |
  | `CC-BY-NC-ND` | false | false | 'unknown' | true | false |

- **H2 — NC × `redistribution` intent = `'unknown'`** (→ needs-review). CC-NC grants *non-commercial* sharing; the `redistribution` intent doesn't model commercial vs non-commercial. `true` would fail open for commercial redistributors; `false` would state a falsehood ("not granted"). `'unknown'` is the honest tri-state. Behavior delta vs today: denied → needs-review (still conservative).
- **H3 — `CC-BY-ND` commercialUse = true** (verbatim commercial use is granted). `ai-generation-input` stays denied via `derivatives: false`.
- **H4 — `LICENSE_PERMISSIVENESS`** (rerank.ts, exhaustively typed — typecheck forces this update): `CC-BY-ND` 0.55, `CC-BY-NC` 0.45, `CC-BY-NC-SA` 0.4, `CC-BY-NC-ND` 0.35 (all above `unknown` 0.3, below `CC-BY-SA` 0.65).
- **H5 — `licenseVersion`** captured for all CC families incl. the new four (extend the BY/BY-SA-only guard in each mapper and in `mapCcDeedUrl`).
- **H6 — rightsstatements.org untouched.** `NoC-NC`/`InC*` are rights-STATUS statements, not CC grants; their existing mapping stands. CC deed URLs flowing through `mapRightsUrl` pick the new families up automatically via `mapCcDeedUrl`.
- **H7 — Semver:** minor for core + each touched provider. Changeset MUST note: consumers with exhaustive `switch (license)` need new arms (same class of change as the §1 rename, which also shipped as minor).

**Verify:** `pnpm -r typecheck && pnpm test:run`; the proof tests are (a) NC ref + `internal-moodboard` → `allowed` AND `buildAttribution().required === true`, (b) verdict reason names `CC-BY-NC`, not `proprietary`.

---

## Wave 2 — Orchestrator hardening (client.ts cluster)

**Why one wave:** per-provider timeout, retry, latency metadata, and query cache all rewrite the same fan-out path in `client.ts:searchInternal` and the `SearchMeta`/`ProviderSearchStatus` types. Four separate PRs would churn the same tests four times.

**Scope:** `RefkitOptions.resilience` (soft timeout + single backoff retry on 429/5xx), `ProviderSearchStatus.latencyMs`, per-provider result cache on the existing (currently dead) `KeyValueCache` port.

**Locked decisions:**

- **H8 — Resilience defaults ON:** `resilience?: { timeoutMs?: number; retries?: number } | false` — defaults `timeoutMs: 10_000`, `retries: 1` (429/5xx/network-error only, exponential backoff with jitter); `false` disables. A timed-out provider is reported `status: 'failed', error: 'timeout after Nms'`; the search never rejects because of one provider.
- **H9 — No `AbortSignal.any` dependency:** repo declares no `engines`; compose caller signal + timeout with a manual listener helper so core stays runtime-agnostic. `setTimeout` in core does not violate zero-network (the invariant test scans for `fetch(`/endpoints only — confirm it stays green).
- **H10 — Cache is per-provider, pre-merge:** key `refkit:v1:<providerId>:<fnv1a(JSON(normalizedQuery))>`, value = JSON of parsed refs, TTL via new `RefkitOptions.cacheTtlMs` (default 5 min when a cache is supplied). Caching per-provider (not post-merge) keeps rerank/gate/merge live on every call. Cache hits are marked in `ProviderSearchStatus` (`cached: true`).
- **H11 — latencyMs** measured around each provider promise (cache hits report ~0 + `cached`).

**Verify:** fake-timer vitest coverage for timeout/retry/backoff; a hanging-provider test proving partial results return within budget.

---

## Wave 3 — Test infrastructure (two parallel tracks; needs Wave 1 merged)

- **3a — `packages/provider-testkit`** (`private: true`, consumed as workspace devDependency — publishing is a later decision, YAGNI). One entry `assertProviderConformance(provider, fixtures)` encoding the D1–D8 + H1–H6 rules as executable assertions: schema-valid refs at the boundary, strict-deny license mapping table, `preview.url`/`thumbnail.url` never a web page (D8 heuristics), URL-param whitelisting, `licenseVersion` only on CC families. Migrate 2–3 existing provider test files onto it as the proof; the rest migrate opportunistically.
- **3b — Live smoke against real APIs** (today ALL tests are offline fixtures — upstream drift is invisible): per-provider `src/__tests__/live.test.ts` gated by `REFKIT_LIVE=1` (+ the provider's key env), one real query asserting response *shape* via zod. New `.github/workflows/live-smoke.yml`: weekly cron, keyless providers always, BYOK providers when repo secrets exist. Never runs in the PR-blocking `ci.yml`.

---

## Wave 4 — Capability extensions (parallel tracks)

- **4a — Intent generalization:** export `evaluatePermissions(rights, required: Array<keyof LicenseFacts>)` from core; `evaluateUse` refactors into presets on top of it (behavior-identical — existing tests must pass unchanged). No custom-intent registry (YAGNI until a host asks).
- **4b — Pagination semantics:** minimum viable = document that `controls.page` is provider-local (README + jsdoc) and add a "load more without overlap" recipe using canonical-URL keys. A global cursor over RRF fusion is explicitly out of scope.
- **4c — MCP surface:** add `evaluate_use` + `build_attribution` tools taking explicit fields (`license`, `licenseVersion`, `author`, `title`, `canonicalUrl`, `intent`) so they're **stateless** — no server-side session cache needed. Unify CLI env vars to `REFKIT_<PROVIDER>_KEY` with the current names kept as fallbacks (document both).
- **4d — Semantic-rerank cookbook:** `docs/examples/semantic-rerank.md` with a runnable BYO-embedding `Reranker` sample. No new published package (YAGNI; the seam exists, it needs a recipe, not a dependency).

---

## Deferred (explicitly NOT scheduled — revisit on demand signals)

- Text/video source expansion (product-positioning call first; roadmap §4 skip-list logic still holds).
- `3d` modality (core enum change; batch with real downstream demand).
- Rights snapshots / ToS-drift archiving (wait for a real audit requirement).
- More providers generally — the leverage this cycle is engine depth, not satellite count.

## Execution mechanics

1. One wave at a time; author `2026-MM-DD-<wave-name>.md` (full writing-plans format) at wave start; execute task-by-task with fresh subagents; review between tasks.
2. Waves 3/4: parallel tracks in isolated worktrees; **serialize** any shared-file wiring (mcp/cli.ts, root README, vitest.config.ts) into a final integration pass — same rule as the P1-providers S9 precedent.
3. Every PR: changeset per touched package; `pnpm -r typecheck && pnpm test:run` green before merge; core version bumps minor per wave that touches it.
4. Wave order: **1 → 2 → 3 → 4**. If wall-clock matters, 3b (live smoke) has no dependency on Wave 1/2 and may start anytime.
