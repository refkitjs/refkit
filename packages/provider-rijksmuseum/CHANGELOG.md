# @refkit/provider-rijksmuseum

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [0c3c346]
- Updated dependencies [6f05cfa]
  - @refkit/core@0.10.0

## 0.4.0

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

## 0.3.0

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

## 0.2.3

### Patch Changes

- Updated dependencies [3cce5e3]
  - @refkit/core@0.7.0

## 0.2.2

### Patch Changes

- 5b50432: Repo moved to the refkitjs GitHub org: add `repository` (with per-package `directory`), `homepage`, and `bugs` metadata to every public package, and point the gutendex default User-Agent at github.com/refkitjs/refkit.
- Updated dependencies [5b50432]
  - @refkit/core@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [991d467]
- Updated dependencies [8300c18]
- Updated dependencies [c6b6061]
  - @refkit/core@0.6.0

## 0.2.0

### Minor Changes

- 2b16960: Add @refkit/provider-rijksmuseum: Rijksmuseum as license-normalized image references (keyless; CC0 / Public Domain).

  Register the P1 providers in the @refkit/mcp zero-config server — rijksmuseum, polyhaven, ambientCG and internet-archive (keyless); freesound, jamendo and europeana (when their API key/token is set).

### Patch Changes

- Updated dependencies [2b16960]
  - @refkit/core@0.5.0
