---
"@refkit/core": minor
---

Architecture-review hardening:

- **Conservative cross-source rights merge** — when two sources disagree about the license of the same canonical URL, the stricter license wins (incomparable claims collapse to `unknown` → needs-review); conflicts surface in `meta.warnings` and via the new `merge.onRightsConflict` observer. New export: `stricterLicense`, `RightsConflict`.
- **Unified pagination cursor** — `SearchInput.cursor` + `meta.nextCursor`: opaque load-more cursor that first drains the current provider page's overfetched pool, then advances the provider-local page internally, deduping against previously returned results (seen-set capped so cursors stay small).
- **CJK-aware `tokenize`** — CJK runs tokenize into character bigrams, so `lexicalReranker` scores Chinese/Japanese/Korean queries instead of dropping them.
- **Collision-proof cache keys** — per-provider cache keys stay short and fixed-shape (safe for strict KV backends), while the cached value embeds the full normalized-query fingerprint and is verified on read: a key collision degrades to a cache miss, never to another query's results. Existing cache entries are invalidated by the format change (`refkit:v2:`).
- New `cacheRaw: false` option strips `raw` provider payloads from cache entries.
- New `concurrency` option bounds how many provider searches run at once per search call (default unlimited, matching previous behavior); a queued provider's timeout starts only when it actually runs.
- **Deprecations (single-track capability routing)** — `SearchFilters`, `SearchInput.filters`, `NormalizedQuery.filters`, `ReferenceProvider.queryFeatures` (now optional), and `QueryFeature` are deprecated. Routing is driven solely by `capabilities.controls`; legacy `filters` are merged into `controls` and the deprecated `NormalizedQuery.filters` channel is derived from the routed controls, so both channels always agree. Providers that declared filter support only via `queryFeatures` must declare `capabilities.controls` to keep receiving those values.
- `runProviderSearch` / `providerCacheKey` / `stableStringify` extracted and exported (`provider-run`), shrinking the search orchestrator.
