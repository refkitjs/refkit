---
'@refkit/core': minor
'@refkit/mcp': minor
'@refkit/provider-artic': minor
'@refkit/provider-brave': minor
'@refkit/provider-europeana': minor
'@refkit/provider-flickr': minor
'@refkit/provider-freesound': minor
'@refkit/provider-gutendex': minor
'@refkit/provider-internet-archive': minor
'@refkit/provider-jamendo': minor
'@refkit/provider-met': minor
'@refkit/provider-nailbook': minor
'@refkit/provider-openverse': minor
'@refkit/provider-pexels': minor
'@refkit/provider-pixabay': minor
'@refkit/provider-poetrydb': minor
'@refkit/provider-polyhaven': minor
'@refkit/provider-rijksmuseum': minor
'@refkit/provider-smithsonian': minor
'@refkit/provider-unsplash': minor
'@refkit/provider-wikimedia-commons': minor
---

Accuracy and contract redesign: license **facts** drive every rights decision, providers
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
  surface — `@refkit/mcp` imports these instead of keeping local copies.
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
