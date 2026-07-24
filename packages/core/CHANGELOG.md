# @refkit/core

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
