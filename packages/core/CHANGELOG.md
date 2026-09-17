# @refkit/core

## 0.9.0

### Minor Changes

- 4dfd41a: Accuracy and contract redesign: license **facts** drive every rights decision, providers
  only describe what their source knows, and the default search path ranks for the query
  without a host-supplied model.

  These are **breaking** changes to the public surface. Every package is still `0.x`, so
  they ship as `minor` per semver's pre-1.0 rule — nothing is aliased or shimmed, so read
  the removed/added lists before upgrading.

  ### Rights: facts, not license ids

  - `LicenseId` is now an **open** string (`KnownLicenseId | (string & {})`); an id with no
    row in `LICENSE_FACTS` resolves to the `unknown` row, which grants nothing.
  - Added `RightsRecord.facts?: LicenseFacts` — a source whose terms are narrower than the
    label it declares supplies its own row. Added `factsOf(rights)`, `licenseFactsSchema`,
    `isKnownLicenseId`, `isIndeterminate`, `compareRestrictiveness(factsA, factsB)` and
    `permissivenessScore(facts)`.
  - **Removed** `stricterLicense(idA, idB)` (replaced by `compareRestrictiveness`) and the
    reranker's internal `LICENSE_PERMISSIVENESS` table (replaced by `permissivenessScore`).
  - Cross-source conflict detection is keyed on facts, not labels: identical facts under
    different ids (`CC0-1.0` vs `PD`) no longer conflict, the same id with narrower facts
    now does, and `RightsConflict.licenses` lists the source-declared ids involved.
  - `rightsRecordSchema` now rejects a `licenseVersion` on a non-CC-family license.
    `CC_VERSIONED_FAMILIES` and `ccVersionFor` moved from `provider-helpers` to `license`
    (still exported from the package root).

  ### Providers emit, core completes

  - Added `EmittedReference` — what `ReferenceProvider.search` now returns:
    `modality, kind?, title?, description?, tags?, sourceUrl, canonicalUrl?, rights,
thumbnail?, preview?, perceptualHash?, visual?, text?, sourceScore?, raw?`. **Every
    `@refkit/provider-*` factory's `search` signature changed accordingly.**
  - Core stamps `id`, `source`, `canonicalUrl`, `verifiedAt` and `relevance` and applies the
    per-provider `limit`: added `completeReference`, `parseEmitted`, `emittedReferenceSchema`.
    Providers no longer compute ids, write provenance, or post-truncate.
  - `Reference` and `EmittedReference` gained `description`, `tags: string[]` and
    `sourceScore`. Met, Art Institute of Chicago, Wikimedia Commons and Rijksmuseum now
    populate descriptive fields (and Art Institute also reports its upstream `_score`), which
    directly sharpens ranking.
  - Added `okJson(res, label)` for provider mappers, `plainText`, and
    `RefkitOptions.userAgent` (`'refkit-client/1'` by default; Art Institute's edge rejects
    Node's default UA) plus `withDefaultUserAgent`.

  ### One search channel, one control registry

  - **Removed** `SearchFilters`, `SearchInput.filters`, `NormalizedQuery.filters`,
    `SearchMeta.appliedFilters`, `QueryFeature`, `ReferenceProvider.queryFeatures`, the legacy
    feature→control routing, and the MCP `filters` parameter. Use `controls` /
    `capabilities.controls`.
  - Control types and the `key → path` registry moved to `controls.ts`; added `CONTROL_PATHS`,
    `SEARCH_CONTROL_KEYS`, `getControl`, `setControl`, `hasControl`,
    `buildSearchControlsSchema`, `searchControlsSchema`, `searchControlKeySchema`,
    `searchMetaSchema`, `providerSearchStatusSchema` and the `MODALITIES` tuple to the public
    surface — `@refkit/mcp` imports only `buildSearchControlsSchema` and `searchMetaSchema`
    from core, and derives its modality enum from the registered providers rather than
    keeping a local copy.
  - Orchestrator stages are exported for testing and reuse: `selectProviders`,
    `PROVIDER_SKIP_REASONS`, `runPass`, and `SearchMeta.passes` (per-pass latency, warnings
    and rights conflicts now accumulate across cursor page advances).

  ### Accuracy defaults

  - **Source confidence** (`RefkitOptions.sourceConfidence`, default on, floor `0.1`) weights
    each source's rank-fusion contribution by how much of its batch mentions the query; each
    fulfilled source reports `meta.providers[].confidence`. Added `sourceConfidence` and
    `lexicalHit`; `MergeOptions.weights` applies the weights.
  - **Reranking is on by default**: `RefkitOptions.rerank` / `SearchInput.rerank` default to
    `lexicalReranker()`, `false` returns raw fusion order. The lexical reranker now scores
    over `title + description + tags + excerpt`, blends the incoming fused relevance
    (`fusionWeight`, default `0.5`), and adds a same-source near-duplicate-title penalty
    (`nearDuplicatePenalty`, `nearDuplicateThreshold`) and an optional `sourceScoreWeight`.
    Added `refText` alongside `tokenize`. MCP's `rerank` parameter now defaults to true.
  - **Relevance threshold**: `SearchInput.minRelevance` drops results the ranker scored below
    the bar (after rerank, before the gate) and reports `SearchMeta.threshold`
    (`SearchThresholdMeta`). New MCP `minRelevance` parameter. The bar is graded against the
    reranker's blended score and does not transfer to `rerank: false`.
  - **Query acceptance**: `ReferenceProvider.accepts?({ text, modalities })` lets a narrow
    source decline queries it cannot answer — skipped with `reason: 'declined'`, bypassed by
    an explicit `sources` whitelist, and an all-declined search returns an empty result
    instead of throwing. `@refkit/provider-nailbook` declines queries that do not name nails;
    `@refkit/provider-polyhaven` now matches each query token independently and ranks assets
    by how many tokens they match.
  - **Whole-search deadline and gate context**: `SearchInput.deadlineMs` (bounds the whole
    call, cursor advances included) and `SearchInput.gateContext.userJurisdiction` (forwarded
    to the search-time gate, matching `evaluateUse`). Both are exposed as MCP parameters.

  The internal `@refkit/provider-testkit` (private, never published) dropped its id-prefix,
  providerId and licenseVersion conformance rules — core now guarantees all three — and
  completes emitted items exactly as the orchestrator does before asserting the rules that
  remain a satellite's own responsibility.

## 0.8.0

### Minor Changes

- b5bbba8: Shrink the load-more cursor to roughly half its size: `meta.nextCursor` is now
  a binary-packed base64url string (magic + version + page + raw fnv1a uint32
  seen-keys) instead of v1's JSON array of base36 hash strings — a full 500-entry
  cursor drops from ~5k to ~2.7k chars. Cursors ride inside LLM tool outputs
  downstream (and get replayed through conversation history), so every char
  counts; ~2.7k also clears consumers that clamp tool-output strings at 4k.

  The cursor stays opaque and self-contained: pass back `meta.nextCursor`, get
  the next deduped batch, no caller-side bookkeeping, no client instance state.
  Anything else — including a v1 JSON cursor from a previous release — still
  fails loudly with "invalid cursor" rather than quietly restarting from page 1
  (cursors are short-lived load-more state, not durable ids; there is no v1
  migration).

  New `createRefkit({ maxCursorSeen })` caps how many already-returned keys the
  cursor remembers (default unchanged at 500, most recent kept, ~5.4 chars each)
  for callers who want an even tighter cursor and can accept re-showing
  long-evicted results sooner. `Infinity` disables the cap; the effective floor
  is the batch just returned, so a too-small cap can never make load-more repeat
  the batch it just handed back.

  Hardening over v1, both restoring guarantees the removed zod schema provided:
  an out-of-uint32-range `controls.page` (negative, fractional, `NaN`, ≥ 2^32)
  encodes as a poison cursor that fails loudly on the next call instead of
  silently wrapping to a different page, and non-canonical base64url (tampered
  trailing bits) is rejected rather than silently aliased to a valid cursor.

- 431d834: Provider resource declarations: open `ResourceKind` vocabulary with optional
  `kinds` + `description` on providers and `kind` on references; declaration-gated
  kind routing (a kind-filtered search skips providers whose declared `kinds`
  lack the value, with a new `unsupported-kind` skip reason) composed with the
  existing `sources` id filter; MCP tool schema, per-provider source list, and
  the `modalities` / `media.kind` enums now derived from registered provider
  declarations at startup.

  Note: the MCP `modalities` input enum is now deployment-dependent (derived
  from the registered providers). A request naming a modality no registered
  provider supports is now rejected at the schema boundary — previously a
  fully-unsupported request threw at search time, and a mixed request (e.g.
  image+audio against an image-only deployment) returned the supported subset.
  Fail-loud at the boundary is intentional.

- aa4b048: Add source-targeted search. `SearchInput.sources?: string[]` restricts a search
  to specific provider ids (intersected with modality matching); omit it to fan out
  to every configured source as before. This lets a caller scope a search-engine
  operator — e.g. `site:xiaohongshu.com` against Brave's index — to one
  web-discovery source without polluting the other providers' queries.

  Selection stays fail-loud: a `sources` list that matches no configured provider
  for the requested modalities throws (a typo must not read as "no results"), while
  an id that resolves to nothing when others still match is reported in
  `meta.warnings`. Providers excluded by an explicit `sources` filter now report
  `reason: 'not-selected'` in `meta.providers`, distinct from `'unsupported-modality'`.

  `@refkit/mcp`'s `search_references` tool gains a `sources` parameter (its
  description enumerates the server's enabled source ids) and turns a
  source-selection miss into an agent-friendly tool error that lists the valid ids.

## 0.7.0

### Minor Changes

- 3cce5e3: Architecture-review hardening:

  - **Conservative cross-source rights merge** — when two sources disagree about the license of the same canonical URL, the stricter license wins (incomparable claims collapse to `unknown` → needs-review); conflicts surface in `meta.warnings` and via the new `merge.onRightsConflict` observer. New export: `stricterLicense`, `RightsConflict`.
  - **Unified pagination cursor** — `SearchInput.cursor` + `meta.nextCursor`: opaque load-more cursor that first drains the current provider page's overfetched pool, then advances the provider-local page internally, deduping against previously returned results (seen-set capped so cursors stay small).
  - **CJK-aware `tokenize`** — CJK runs tokenize into character bigrams, so `lexicalReranker` scores Chinese/Japanese/Korean queries instead of dropping them.
  - **Collision-proof cache keys** — per-provider cache keys stay short and fixed-shape (safe for strict KV backends), while the cached value embeds the full normalized-query fingerprint and is verified on read: a key collision degrades to a cache miss, never to another query's results. Existing cache entries are invalidated by the format change (`refkit:v2:`).
  - New `cacheRaw: false` option strips `raw` provider payloads from cache entries.
  - New `concurrency` option bounds how many provider searches run at once per search call (default unlimited, matching previous behavior); a queued provider's timeout starts only when it actually runs.
  - **Deprecations (single-track capability routing)** — `SearchFilters`, `SearchInput.filters`, `NormalizedQuery.filters`, `ReferenceProvider.queryFeatures` (now optional), and `QueryFeature` are deprecated. Routing is driven solely by `capabilities.controls`; legacy `filters` are merged into `controls` and the deprecated `NormalizedQuery.filters` channel is derived from the routed controls, so both channels always agree. Providers that declared filter support only via `queryFeatures` must declare `capabilities.controls` to keep receiving those values.
  - `runProviderSearch` / `providerCacheKey` / `stableStringify` extracted and exported (`provider-run`), shrinking the search orchestrator.

## 0.6.1

### Patch Changes

- 5b50432: Repo moved to the refkitjs GitHub org: add `repository` (with per-package `directory`), `homepage`, and `bugs` metadata to every public package, and point the gutendex default User-Agent at github.com/refkitjs/refkit.

## 0.6.0

### Minor Changes

- 991d467: Add first-class CC NC/ND license families: `CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-NC-ND`, `CC-BY-ND`.

  NC/ND-licensed results no longer collapse to `proprietary`: they keep their real
  family id (+ CC version), generate the attribution the license requires, and
  verdicts name the actual license in their reasons. Gating stays strict-deny —
  commercial/AI use of NC content is still denied; NC × `redistribution` intent now
  returns `needs-review` (was `denied`) because the intent cannot distinguish
  commercial from non-commercial redistribution. `CC-BY-ND` now correctly allows
  verbatim commercial reuse (`allowed-with-attribution`) while AI/derivative use
  stays denied.

  Note for TypeScript consumers: exhaustive `switch` statements over `LicenseId`
  need arms for the four new ids.

- 8300c18: Export evaluatePermissions/PermissionKey/EvaluateOptions — programmable strict-deny gate; evaluateUse intents are now presets over it (behavior unchanged).
- c6b6061: Harden the search orchestrator: per-provider soft timeout (default 10s) and
  bounded retry on 429/5xx/network errors (default 1, exponential backoff) — on by
  default, tunable or disabled via `createRefkit({ resilience })`. Provider
  statuses in `searchWithMeta` now carry `latencyMs`, and supplying a `cache`
  (`KeyValueCache`) now memoizes per-provider results (key
  `refkit:v1:<provider>:<queryHash>`, TTL via the new `cacheTtlMs` option, default
  5 min) with hits flagged `cached: true`. Merge, rerank, and the license gate
  always run fresh. New exports: `withTimeout`, `retryingFetch`, and the
  `ResilienceOptions`, `TimeoutHandle`, `RetryOptions` types.

  The MCP `search_references` structured output (`explain: true`) now surfaces
  `latencyMs` per provider and `cached` on cache hits.

## 0.5.0

### Minor Changes

- 2b16960: Add shared provider helpers to @refkit/core (setIf\* URL setters, first, mapCcDeedUrl, mapRightsUrl, image-URL heuristics) and refactor all providers to use them instead of per-package copies.

## 0.4.0

### Minor Changes

- 8c221f8: Add unified search controls, provider capability metadata, MCP controls input, search metadata/explanations, practical provider-specific `providerOptions` whitelists, and a core duplicate hook for agent-facing searches.

## 0.3.0

### Minor Changes

- 451271b: Add `SearchInput.poolFactor`: overfetch a wider candidate pool per provider (default 4×, capped at 100/source) before merge/rerank/gate, then narrow to `limit`. Fixes pool starvation — dedup and ranking now operate on real candidates instead of a source-truncated slice. Non-finite or `< 1` factors fall back to the default.

  Also: `buildAttribution` now includes the precise `licenseVersion` (e.g. "CC-BY 4.0" instead of "CC-BY") when the source provides it.

### Patch Changes

- fa930f9: Fix a latent stack overflow in `mergeReferences`: the RRF max-normaliser used
  `Math.max(...score.values())`, which throws `RangeError: Maximum call stack size
exceeded` once the merged pool gets large (~10^5 unique results) — the same
  spread-overflow already guarded against in `lexicalReranker`'s quality pass. It
  now computes the max with a reduce loop, preserving the "top result relevance =
  exactly 1.0" invariant, and the inaccurate "empty input returns [] earlier"
  comment is corrected.

## 0.2.0

### Minor Changes

- 5e27c09: Widen the rerank seam to { query, refs, signal } and add a zero-dependency
  lexicalReranker (query term-coverage + resolution/license weighting + MMR-lite
  source diversity). Model-based rerankers stay BYO via the hook.
