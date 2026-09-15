# Accuracy and Contract Redesign — Design Spec

Status: approved 2026-09-14. The library has no external users; there is no
backward-compatibility obligation. Deprecated surfaces are deleted, not aliased.

## Goals

1. Make the default search path return relevant results across the keyless sources
   without a host-supplied model: source-confidence weighting in the merge, a default
   lexical reranker over richer text, an opt-in relevance threshold, and per-provider
   query acceptance.
2. Move the core to its first principles: the use-gate, merge conflict resolution and
   reranker consume **license facts**, never a closed id enum; the core stamps every
   field that is its own concern (id, provenance, verifiedAt, relevance, limit) so
   providers only describe what the source knows.
3. Collapse hand-maintained mirrors: one control registry, one set of zod schemas
   exported from core and reused by MCP, one search channel.

## Non-goals

- Splitting `@refkit/mcp` into adapter + batteries.
- Modality-specific audio/video metadata (duration etc.).
- Semantic (embedding) reranking inside core — the `Reranker` hook stays the seam.
- Rewriting Rijksmuseum's query strategy (its API semantics are not verifiable offline).

## Decisions

### D1 — License facts are the gate's input

- `LicenseId` becomes an **open** string: `KnownLicenseId | (string & {})`. Known ids keep
  their row in `LICENSE_FACTS`. An unknown id without facts resolves to the `unknown`
  facts row (strict-deny by construction).
- `RightsRecord.facts?: LicenseFacts` — a provider-supplied facts row. Required in
  practice for custom ids; for known ids it overrides the table (a source whose terms
  are narrower than the label). `factsOf(rights)` = `rights.facts ?? factsFor(rights.license)`.
- `evaluatePermissions`, merge conflict resolution, attribution and the lexical
  reranker read facts via `factsOf`. No code path keys behaviour on the id string
  except the human-readable reason text.
- `stricterLicense(idA, idB)` is replaced by `compareRestrictiveness(factsA, factsB)`
  returning `'a' | 'b' | 'equal' | 'incomparable'`. A record whose three tri-state
  axes are all `'unknown'` is *indeterminate*; any conflict involving an indeterminate
  side resolves to `unknown` (preserves today's invariant).
- The reranker's hand-written `LICENSE_PERMISSIVENESS` table is replaced by
  `permissivenessScore(facts)` in 0..1: `(2·c + 2·d + 2·r + g·(attr + sa)) / 8` where a
  tri axis counts 1 for `true` and 0 otherwise (unknown counts as not granted, mirroring
  the gate), `g = (c + d + r) / 3` is the grant fraction, `attr` is 1 when attribution is
  not required, `sa` is 1 when share-alike is off. Obligation credit is scaled by the
  grant fraction so a row that grants nothing (proprietary, unknown) scores 0 and can
  never outrank a real CC grant. Resulting order: CC0/PD 1 > CC-BY 0.875 > CC-BY-SA 0.75
  > unsplash/pexels/pixabay 0.667 > CC-BY-ND 0.583 > CC-BY-NC 0.292 > CC-BY-NC-SA 0.25 >
  CC-BY-NC-ND = proprietary = unknown = 0.
- `compareRestrictiveness` returns `'incomparable'` whenever either operand is
  indeterminate, so the public comparator never orders an all-unknown row.
- Cross-source conflict detection is keyed on **facts**, not labels: two records for
  the same canonical URL conflict iff their facts rows differ (five-axis fingerprint
  inequality). Same id with narrower supplied facts is a conflict; CC0 vs PD (identical
  facts) is not; two sources both declaring `unknown` is not. `RightsConflict.licenses`
  lists the distinct source-declared ids involved (possibly a single id).
- `licenseVersion` may only be present when `license` is one of the six versioned CC
  families; enforced by a zod refine on `rightsRecordSchema`. `CC_VERSIONED_FAMILIES`
  and `ccVersionFor` move to `license.ts`.

### D2 — Providers emit, core completes

- New `EmittedReference` (what `ReferenceProvider.search` returns):
  `modality, kind?, title?, description?, tags?, sourceUrl, canonicalUrl?, rights,
  thumbnail?, preview?, perceptualHash?, visual?, text?, sourceScore?, raw?`.
- `Reference` = `EmittedReference` minus `sourceUrl`, plus `id`, `source`, `canonicalUrl`
  (required), `verifiedAt`, `relevance`. New optional fields on both: `description`,
  `tags: string[]`, `sourceScore: number` (upstream score, provider scale, only order
  within one source is meaningful).
- `completeReference(providerId, emitted, now)` stamps `id = referenceId(providerId,
  sourceUrl)`, `source = { providerId, sourceUrl }`, `canonicalUrl = emitted.canonicalUrl
  ?? sourceUrl`, `verifiedAt = now`, `relevance = 0`. `runProviderSearch` parses each
  item with `emittedReferenceSchema`, completes it, then truncates to `query.limit`.
  Providers never write those fields and never post-truncate.
- `okJson<T>(res, label)` in provider-helpers replaces the per-provider
  `if (!res.ok) throw … ; await res.json()` pair.
- `RefkitOptions.userAgent?: string | false` (default `'refkit-client/1'`) is injected
  into every provider fetch that carries no User-Agent header. Art Institute of
  Chicago's edge rejects Node's default UA; a descriptive one returns 200.
- Testkit: the id-prefix, providerId and licenseVersion conformance rules are deleted
  (core now guarantees them); the kinds rule and the D8 image rules stay.

### D3 — One search channel

Deleted outright: `SearchFilters`, `SearchInput.filters`, `NormalizedQuery.filters`,
`SearchMeta.appliedFilters`, `QueryFeature`, `ReferenceProvider.queryFeatures`, the
legacy feature→control routing, and the MCP `filters` parameter.

### D4 — One control registry, schemas exported from core

- `controls.ts` holds the `SearchControls` types and `CONTROL_PATHS`, a `key → path`
  table. `SearchControlKey`, `SEARCH_CONTROL_KEYS`, `getControl`, `setControl`,
  `hasControl` and `buildSearchControlsSchema(kinds?)` all derive from it.
- `schemas.ts` exports `searchMetaSchema` and `providerSearchStatusSchema`.
  `modality.ts` exports the `MODALITIES` tuple. MCP imports these and keeps no local
  copies.

### D5 — Orchestrator stages and multi-pass fidelity

- `select.ts`: `selectProviders(providers, { modalities, sources, kind, text })` returns
  `{ chosen, skipReasons, unknownSources }` and owns the "no provider" errors.
- `pipeline.ts`: one `runPass(deps, page)` composed of named stages (fan-out, status
  collection, merge, rerank, threshold, gate, seen-filter). `client.ts` keeps option
  resolution, the cursor loop and meta assembly.
- Cursor advance passes accumulate: `SearchMeta.passes` (count), per-provider
  `latencyMs` summed across passes, failure warnings labelled per pass, rights
  conflicts concatenated (deduped by URL).
- `SearchInput.deadlineMs?` — whole-search deadline composed with the abort signal.
- `SearchInput.gateContext?: { userJurisdiction?: string }` — forwarded to the
  search-time gate, matching `client.evaluateUse`.

### D6 — Accuracy defaults

- **Source confidence.** Per pass, each source's batch gets a weight
  `floor + (1 − floor) · hitRate`, where `hitRate` is the fraction of its refs whose text
  (title + description + tags + excerpt) contains any query token and `floor` defaults
  to 0.1. `mergeReferences` accepts `weights` parallel to `perSource` and multiplies
  each RRF contribution by it. `RefkitOptions.sourceConfidence?: boolean | { floor }`
  (default on). Each `ProviderSearchStatus` reports its `confidence`.
- **Default reranker.** `RefkitOptions.rerank?: Reranker | false` defaults to
  `lexicalReranker()`; `SearchInput.rerank?: Reranker | false` overrides per call.
  MCP `rerank` defaults to true.
- **Lexical reranker** scores over title + description + tags + excerpt, adds a
  same-source near-duplicate penalty (`nearDuplicatePenalty` 0.25 when title-token
  Jaccard with an already-picked ref from the same source ≥ 0.7) and an optional
  `sourceScoreWeight` (default 0) over per-source min-max normalised `sourceScore`.
- **Threshold.** `SearchInput.minRelevance?` drops refs below it after rerank and gate,
  before the seen-filter and limit; `SearchMeta.threshold = { minRelevance, dropped }`.

### D7 — Provider acceptance

- `ReferenceProvider.accepts?(query: { text, modalities }): boolean`. A provider that
  returns false is skipped with reason `'declined'`. An explicit `sources` whitelist
  bypasses `accepts`. If every modality-matching provider declines, the search returns
  an empty result (no throw).
- nailbook accepts only queries mentioning nail art
  (`/nail|manicure|ネイル|ジェル|美甲|指甲|甲油/i`).
- polyhaven matches each whitespace token independently against id, name, categories
  and tags and ranks assets by number of matched tokens.

### D8 — Descriptive fields in the keyless museum/archive sources

- Met: `description` from objectName, medium, culture, period; `tags` from
  classification and the object `tags[].term`.
- Art Institute: request `short_description, medium_display, classification_titles,
  subject_titles, term_titles`; `description` = stripped short_description or
  medium_display; `tags` = the three title lists deduped; `sourceScore` = `_score`.
- Wikimedia Commons: `description` = stripped `ImageDescription` (≤ 500 chars);
  `tags` = `Categories` split on `|`.
- Rijksmuseum: `description` from the EDM record's localized description, same
  language preference as title.

## Global constraints (binding for every task)

- Toolchain: pnpm workspace, Node ≥ 22, ESM only, TypeScript strict, vitest.
- `@refkit/core` depends on nothing but `zod`; its source contains no `fetch(` call and
  no `http(s)://` literal (enforced by `no-network.test.ts`). Every `@refkit/provider-*`
  package depends only on `@refkit/core`.
- No compatibility shims or deprecated aliases: removed surfaces are removed.
- `pnpm typecheck && pnpm lint && pnpm test:run` must pass at the end of every task.
- Commits use conventional prefixes (`feat`, `refactor`, `test`, `docs`) and carry no
  attribution or Co-authored-by trailers.
- Exact type shapes named in this spec (D1, D2, D4–D7) are binding.
