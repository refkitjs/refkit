# @refkit/provider-openverse

## 0.5.1

### Patch Changes

- 9b5b053: Openverse: anonymous requests now ask for at most 20 results. The API answers 401 ("page_size may not exceed 20 for anonymous requests") above that, which made every anonymous search fail under core's default fusion pool. Art Institute of Chicago: cap `limit` at 100, the API's per-page maximum (403 above it).

## 0.5.0

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

### Patch Changes

- Updated dependencies [4dfd41a]
  - @refkit/core@0.9.0

## 0.4.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [b5bbba8]
- Updated dependencies [431d834]
- Updated dependencies [aa4b048]
  - @refkit/core@0.8.0

## 0.3.2

### Patch Changes

- 3cce5e3: Declare and honor the `page` search control (`capabilities.controls: ['page']`), wiring `controls.page` to each source's native pagination — native `page` params where they exist, offset translation for offset-based APIs (Wikimedia `gsroffset`, Smithsonian/Europeana `start`, Jamendo/ambientCG `offset`), and a window over the full result list for Met/Poly Haven. Enables core's unified load-more cursor across these sources. (Brave, PoetryDB, and Rijksmuseum expose no usable offset pagination and keep `page` undeclared.)
- Updated dependencies [3cce5e3]
  - @refkit/core@0.7.0

## 0.3.1

### Patch Changes

- 5b50432: Repo moved to the refkitjs GitHub org: add `repository` (with per-package `directory`), `homepage`, and `bugs` metadata to every public package, and point the gutendex default User-Agent at github.com/refkitjs/refkit.
- Updated dependencies [5b50432]
  - @refkit/core@0.6.1

## 0.3.0

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

### Patch Changes

- Updated dependencies [991d467]
- Updated dependencies [8300c18]
- Updated dependencies [c6b6061]
  - @refkit/core@0.6.0

## 0.2.1

### Patch Changes

- 2b16960: Add shared provider helpers to @refkit/core (setIf\* URL setters, first, mapCcDeedUrl, mapRightsUrl, image-URL heuristics) and refactor all providers to use them instead of per-package copies.
- Updated dependencies [2b16960]
  - @refkit/core@0.5.0

## 0.2.0

### Minor Changes

- 8c221f8: Add unified search controls, provider capability metadata, MCP controls input, search metadata/explanations, practical provider-specific `providerOptions` whitelists, and a core duplicate hook for agent-facing searches.

### Patch Changes

- Updated dependencies [8c221f8]
  - @refkit/core@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [451271b]
- Updated dependencies [fa930f9]
  - @refkit/core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [5e27c09]
  - @refkit/core@0.2.0
