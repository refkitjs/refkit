# @refkit/core

## 0.10.0

### Minor Changes

- 0c3c346: `search_references` results now carry what an agent needs to judge a match and handle the file: the source's `description` (capped at 280 characters), its first 8 `tags`, the `author`, the 0..1 cross-source `relevance`, and `rights.rehostPolicy`. The output schema and the tool description explain each `rehostPolicy` value, so agents know whether they may download, cache or only hotlink a result's media. The per-source `sourceScore` stays out because it is not comparable across sources. Core exports the policy values as `REHOST_POLICIES`, which its own schema now uses as well.
- 6f05cfa: References now have a shape per modality, every public surface calls the catalog a search queries a "source", and audio and video results carry their duration. This release renames and retypes public API; the migration notes below list every break.

  **Upgrade core, MCP and every provider together.** Each `@refkit/provider-*` package pins the exact `@refkit/core` version it was built with, so a host that upgrades core alone ends up with two copies of core.

  ### What changed and why

  #### `Reference` is a union keyed by `modality`

  Before, every result had one flat shape: any modality could carry `visual`, `text` or `preview`, and nothing said which fields belonged together. `EmittedReference` and `Reference` are now unions of four variants. Each variant is exported (`EmittedImageReference`, `EmittedVideoReference`, `EmittedAudioReference`, `EmittedTextReference`, and `ImageReference`, `VideoReference`, `AudioReference`, `TextReference`).

  | `modality` | Its own fields                                                  |
  | ---------- | --------------------------------------------------------------- |
  | `image`    | `preview` (`mediaType` `image/*`), `visual`, `perceptualHash`   |
  | `video`    | `preview` (`mediaType` `video/*`), `visual`, `video: VideoMeta` |
  | `audio`    | `preview` (`mediaType` `audio/*`), `audio: AudioMeta`           |
  | `text`     | `text: TextMeta`                                                |

  - **Common fields.** Every variant keeps `kind`, `title`, `description`, `tags`, `rights`, `thumbnail`, `sourceScore` and `raw`. An emitted item also has `sourceUrl` and an optional `canonicalUrl`; a complete reference has the fields core stamps (`id`, `source`, `canonicalUrl`, `verifiedAt`, `relevance`).
  - **`thumbnail`** is always an image a UI can show: the picture itself, a video poster, audio cover art or a book cover.
  - **`visual`** means the size of the original image or video. A source that only knows a rendition's size leaves `visual` unset and puts that size on `preview.width` / `preview.height`.
  - **Types.** Each variant declares the other variants' fields as `?: never`. A provider that writes a field of another modality, such as `visual` on an audio item, gets a compile error. Code that reads the union still compiles without narrowing: `r.visual` is `VisualMeta | undefined` on any reference.
  - **Runtime.** `emittedReferenceSchema` and `referenceSchema` are discriminated unions on `modality`. An item whose `preview.mediaType` does not start with its variant's prefix (`image/`, `video/`, `audio/`) is rejected. A field that belongs to another modality is stripped.

  #### Audio and video metadata

  There are two new types. Units:

  - **`VideoMeta`**: `durationSec` (seconds, as a float) and `fps`.
  - **`AudioMeta`**: `durationSec` (seconds, as a float), `bitrateKbps` (kilobits per second, bits/s ÷ 1000), `sampleRateHz` (hertz), `channels`, and `format` (a short name such as `mp3`).

  The bundled sources fill them from the responses they already fetch. No source makes an extra request.

  | Source            | Fields                                                                                                                                                                              |
  | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `openverse-audio` | `audio.durationSec` (Openverse's milliseconds ÷ 1000), `audio.bitrateKbps` (bits/s ÷ 1000; Jamendo-sourced items report none), `audio.sampleRateHz` (often missing), `audio.format` |
  | `freesound`       | `audio.durationSec`                                                                                                                                                                 |
  | `jamendo`         | `audio.durationSec`                                                                                                                                                                 |
  | `pexels-video`    | `video.durationSec`                                                                                                                                                                 |
  | `pixabay-video`   | `video.durationSec`                                                                                                                                                                 |

  - **Unset values.** A missing, non-finite, zero or negative duration, bitrate or sample rate leaves the field unset. Openverse reports a duration of 0 for MIDI files it never measured, and zero is never a real measurement for these fields.
  - **Not filled yet.** No bundled source fills `fps` or `channels`. Internet Archive leaves durations unset.

  #### One word for the catalog a search queries: "source"

  A _provider_ is adapter code, such as a `ReferenceProvider` from a `@refkit/provider-*` package. Each provider instance serves one _source_. That source's id (`provider.id`, e.g. `openverse-audio`) is what `sources`, `sourceOptions`, `meta.sources` and each result's `source.id` speak.

  Before, the same id had several names: callers passed `sources`, but results reported `meta.providers[].providerId`, options went under `providerOptions`, errors went to `onProviderError`, and each reference named it `source.providerId`. The rename table is under "Breaking changes".

  #### Fixes

  **openverse-audio**

  - **Thumbnail.** `thumbnail` is the item's album art, and is unset when there is none. It used to point at Openverse's waveform endpoint, which returns JSON peak data, not an image.
  - **Media types.** `preview.mediaType` and `audio.format` now come from one table of known filetypes:

    - Wikimedia's `ogx` files (Ogg streams) are `audio/ogg` with `format: 'ogg'`;
    - MIDI files are `audio/midi`;
    - WebM files are `audio/webm`.

    All of these used to be labelled `audio/mpeg`. Jamendo's `mp31` and `mp32` read as `mp3`.

  - **Unknown filetypes.** An item whose filetype is outside the table has no `preview` and no `format`, instead of a guessed `audio/mpeg`. No such item was seen in live results.
  - **Kind.** `kind` comes from Openverse's `category`: `music` becomes `music`, and `sound_effect` becomes `sound-effect`. Other categories leave it unset. In live results only Jamendo-sourced items carried a mapped category (`music`). Freesound-sourced items carry no category, so they have no `kind`.

  **pixabay-video**

  - **Kind.** `kind` comes from Pixabay's `type`: `film` or `animation`. This source and openverse-audio declared these kinds but never emitted them.
  - **No `visual`.** It no longer sets `visual`, because it only knows a rendition's size. That size stays on `preview`.
  - **Renditions.** When choosing the preview, it skips a rendition whose URL is empty or whose size is 0. Pixabay returns an unavailable `large` rendition that way.

  **Flickr**

  - It no longer sets `visual` from its ≤1024px rendition. The rendition's size stays on `preview`.

  **Internet Archive**

  - It asks only for the mediatypes the query wants: `movies` for video, `texts` for text.
  - A text-only search used to get films: in a live check for "jazz", all 20 results on page one were films.
  - When the query wants neither modality, it returns no results without making a request.

  **Poly Haven**

  - `polyhaven({ assetType: 'hdris' })` has its own source id, `polyhaven-hdri`, so textures (`polyhaven`) and HDRIs can be configured side by side.

  **Core**

  - **Modality leaks.** An item whose `modality` is outside what its source was asked for (the requested modalities that source declares) is rejected like a malformed item. It is dropped, counted in `meta.sources[].rejected`, and passed to `onSourceError`.
  - **Duplicate ids.** `createRefkit` throws when two providers share a source id. Before, this passed silently: the two shared one `meta.sources` entry and one cache key, so one could be answered from the other's cache.
  - **Unknown `sourceOptions` ids.** An id in `sourceOptions` that matches no configured source now adds `unknown sourceOptions id(s) ignored: …` to `meta.warnings`, as an unknown id in `sources` already did.
  - **Typed selection error.** When a search has no source to fan out to, core throws a `SourceSelectionError`. A host can now branch on its fields instead of matching the message. See "Breaking changes".

  #### `@refkit/mcp`

  - **New fields.** Each `search_references` result gains optional `durationSec`, `width` and `height`:

    - `durationSec` is the audio or video length in seconds;
    - `width` and `height` are in pixels: the original's size from `visual`, else the preview rendition's size (same aspect ratio).

    So agents can filter by length or resolution. The output schema describes all three.

  - **Selection misses.** The "unknown sources" tool error is recognised with `isSourceSelectionError` and `code === 'no-matching-source'`, not by reading the message. It still ends with "Enabled source ids: …".
    - `sources: []` now gets that hint too.
    - So does a miss thrown by a client built with another copy of `@refkit/core`.

  ### Breaking changes and how to migrate

  #### Renames

  | Where               | Old                                                                                                                                             | New                                                                                                                              |
  | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
  | search meta         | `meta.providers`                                                                                                                                | `meta.sources`                                                                                                                   |
  | search meta         | `ProviderSearchStatus` (`providerId`), `providerSearchStatusSchema`                                                                             | `SourceStatus` (`sourceId`), `sourceStatusSchema`                                                                                |
  | search meta         | `meta.controls.appliedByProvider` / `ignoredByProvider`                                                                                         | `appliedBySource` / `ignoredBySource`                                                                                            |
  | search meta         | `meta.providerOptions`                                                                                                                          | `meta.sourceOptions`                                                                                                             |
  | skip reasons        | `PROVIDER_SKIP_REASONS`, `ProviderSkipReason`                                                                                                   | `SOURCE_SKIP_REASONS`, `SourceSkipReason` (values unchanged)                                                                     |
  | search input        | `providerOptions`, `ProviderOptionsById`                                                                                                        | `sourceOptions`, `SourceOptionsById`                                                                                             |
  | search input        | `onProviderError`, `ProviderError { providerId }`                                                                                               | `onSourceError`, `SourceError { sourceId }`                                                                                      |
  | reference           | `source: { providerId, sourceUrl }`                                                                                                             | `source: { id, url }`                                                                                                            |
  | pipeline (exported) | `PassDeps.onProviderError`, `PassDeps.providerOptions`, `PassOutcome.statusByProvider`, `normalizeQuery`'s `providerOptions` input              | `onSourceError`, `sourceOptions`, `statusBySource`, `sourceOptions`                                                              |
  | messages            | `no configured provider matches source id(s) …`, `no registered provider supports modalities …`, `all providers failed`, `n provider(s) failed` | `no configured source matches id(s) …`, `no configured source supports modalities …`, `all sources failed`, `n source(s) failed` |
  | MCP input           | `providerOptions`                                                                                                                               | `sourceOptions`                                                                                                                  |
  | MCP output          | `provider` on each reference                                                                                                                    | `source`                                                                                                                         |

  These names stay unchanged:

  - adapter-side names: `RefkitOptions.providers`, `ReferenceProvider`, `defineProvider`, `ProviderContext`, `ProviderOptions`, `selectProviders`, `runProviderSearch`, `providerCacheKey`;
  - `SearchInput.sources` and the MCP `sources` parameter;
  - **`NormalizedQuery.providerOptions`**: provider code keeps reading its own options from `q.providerOptions`.

  #### `Reference` is a type alias of a union

  - **`Omit`.** `Omit<Reference, K>` loses the link between `modality` and its fields. Use a distributive omit:

    ```ts
    type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
      ? Omit<T, K>
      : never;
    ```

  - **`extends`.** An interface can no longer `extend` `Reference` or `EmittedReference` (TS2312). Use a type alias with an intersection, or extend one variant.
  - **Declaration merging.** You can no longer augment `Reference` by declaration merging.
  - **Test fixtures.** A builder that spreads `Partial<Reference>` or `Partial<EmittedReference>` over an image default no longer compiles. Type its parameter as `Partial<ImageReference>` / `Partial<EmittedImageReference>`.

  #### Custom providers

  - **Wrong-modality fields.** Writing a field of another modality is a compile error. At runtime the field is stripped.
  - **Preview media type.** A `preview.mediaType` without the variant's prefix (`image/`, `video/`, `audio/`) rejects the item.
  - **Undeclared modalities.** An item whose `modality` was not asked of the source is rejected. That covers a modality the source does not declare, and one the search did not request.

  #### `SourceSelectionError` and `isSourceSelectionError`

  Core still throws when a search has no source to fan out to, but the error is now typed and its messages have changed. Stop matching the message and branch on the fields:

  - `code` is `'no-matching-source'` or `'no-source-for-query'`:
    - `'no-matching-source'`: `sources` was given and none of it can serve the search (an unknown id, a known id lacking the modality or the kind, or `sources: []`);
    - `'no-source-for-query'`: no `sources` was given, and no configured source supports the modalities (and kind).
  - `requested` is the `sources` as passed.
  - `unknown` lists the ids that match no configured source.
  - `modalities` is the requested modalities.
  - `kind` is set when the search narrowed by `controls.media.kind`.

  Recognise the error with `isSourceSelectionError(e)`, not `instanceof`:

  - it is true for this copy's class;
  - it is also true for an error thrown by another copy of `@refkit/core` that has `name: 'SourceSelectionError'`, a known `code`, and `unknown` and `modalities` arrays.

  `SOURCE_SELECTION_ERROR_CODES` and the `SourceSelectionErrorCode` type are exported.

  #### `runProviderSearch` rejects modality leaks

  - The exported `runProviderSearch` now rejects every live item whose `modality` is not in the `modalities` of the query it is given.
  - A direct call with `modalities: []` therefore rejects every live item.
  - Through `createRefkit` this cannot happen: a source is only searched when it declares one of the requested modalities, so its query's `modalities` is never empty.

  #### Other breaks

  - **One-time cache miss.** The cache key prefix moved from `refkit:v3` to `refkit:v4`. Every entry cached by the previous version is missed once after the upgrade, instead of being parsed in the old shape.
  - **Duplicate source ids.** `createRefkit` now throws on duplicate source ids. Configure each source once.
  - **Poly Haven HDRI ids.** For HDRI users, `polyhaven({ assetType: 'hdris' })` changes its id from `polyhaven` to `polyhaven-hdri`. Reference ids, cache keys, and the `sources` and `sourceOptions` keys for HDRIs change with it. Replace `'polyhaven'` with `'polyhaven-hdri'` wherever you meant the HDRI source.
  - **`visual` on Flickr and pixabay-video.** These results no longer carry `visual`. For their size or aspect ratio, fall back to `preview.width` / `preview.height`, as `@refkit/mcp` does. The reranker's resolution term now treats these results as unknown (neutral) instead of scoring the rendition's size, so they can rank slightly higher in a mixed batch.
  - **MCP `providerOptions`.** The input is now `sourceOptions`. The MCP SDK silently strips unknown input keys, so a call that still sends `providerOptions` loses its options without an error.
  - **MCP agent ref.** Each reference's `provider` is now `source`.
  - **MCP errors with `sources` set.** Errors other than the source miss that are raised while `sources` is set (for example an invalid cursor) are now rethrown by the tool handler. Before, the handler returned its own `isError` result and appended a misleading "Enabled source ids" hint. The MCP SDK still reports a thrown error to the agent as an `isError` result with the error's message, now without the hint.

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
