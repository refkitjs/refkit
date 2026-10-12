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

References now have a shape per modality, every public surface calls the catalog a search queries a "source", and audio and video results carry their duration. This release renames and retypes public API; the migration notes below list every break.

**Upgrade core, MCP and every provider together.** Each `@refkit/provider-*` package pins the exact `@refkit/core` version it was built with, so a host that upgrades core alone ends up with two copies of core.

### What changed and why

#### `Reference` is a union keyed by `modality`

Before, every result had one flat shape: any modality could carry `visual`, `text` or `preview`, and nothing said which fields belonged together. `EmittedReference` and `Reference` are now unions of four variants. Each variant is exported (`EmittedImageReference`, `EmittedVideoReference`, `EmittedAudioReference`, `EmittedTextReference`, and `ImageReference`, `VideoReference`, `AudioReference`, `TextReference`).

| `modality` | Its own fields |
|---|---|
| `image` | `preview` (`mediaType` `image/*`), `visual`, `perceptualHash` |
| `video` | `preview` (`mediaType` `video/*`), `visual`, `video: VideoMeta` |
| `audio` | `preview` (`mediaType` `audio/*`), `audio: AudioMeta` |
| `text` | `text: TextMeta` |

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

| Source | Fields |
|---|---|
| `openverse-audio` | `audio.durationSec` (Openverse's milliseconds ÷ 1000), `audio.bitrateKbps` (bits/s ÷ 1000; Jamendo-sourced items report none), `audio.sampleRateHz` (often missing), `audio.format` |
| `freesound` | `audio.durationSec` |
| `jamendo` | `audio.durationSec` |
| `pexels-video` | `video.durationSec` |
| `pixabay-video` | `video.durationSec` |

- **Unset values.** A missing, non-finite, zero or negative duration, bitrate or sample rate leaves the field unset. Openverse reports a duration of 0 for MIDI files it never measured, and zero is never a real measurement for these fields.
- **Not filled yet.** No bundled source fills `fps` or `channels`. Internet Archive leaves durations unset.

#### One word for the catalog a search queries: "source"

A *provider* is adapter code, such as a `ReferenceProvider` from a `@refkit/provider-*` package. Each provider instance serves one *source*. That source's id (`provider.id`, e.g. `openverse-audio`) is what `sources`, `sourceOptions`, `meta.sources` and each result's `source.id` speak.

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

| Where | Old | New |
|---|---|---|
| search meta | `meta.providers` | `meta.sources` |
| search meta | `ProviderSearchStatus` (`providerId`), `providerSearchStatusSchema` | `SourceStatus` (`sourceId`), `sourceStatusSchema` |
| search meta | `meta.controls.appliedByProvider` / `ignoredByProvider` | `appliedBySource` / `ignoredBySource` |
| search meta | `meta.providerOptions` | `meta.sourceOptions` |
| skip reasons | `PROVIDER_SKIP_REASONS`, `ProviderSkipReason` | `SOURCE_SKIP_REASONS`, `SourceSkipReason` (values unchanged) |
| search input | `providerOptions`, `ProviderOptionsById` | `sourceOptions`, `SourceOptionsById` |
| search input | `onProviderError`, `ProviderError { providerId }` | `onSourceError`, `SourceError { sourceId }` |
| reference | `source: { providerId, sourceUrl }` | `source: { id, url }` |
| pipeline (exported) | `PassDeps.onProviderError`, `PassDeps.providerOptions`, `PassOutcome.statusByProvider`, `normalizeQuery`'s `providerOptions` input | `onSourceError`, `sourceOptions`, `statusBySource`, `sourceOptions` |
| messages | `no configured provider matches source id(s) …`, `no registered provider supports modalities …`, `all providers failed`, `n provider(s) failed` | `no configured source matches id(s) …`, `no configured source supports modalities …`, `all sources failed`, `n source(s) failed` |
| MCP input | `providerOptions` | `sourceOptions` |
| MCP output | `provider` on each reference | `source` |

These names stay unchanged:

- adapter-side names: `RefkitOptions.providers`, `ReferenceProvider`, `defineProvider`, `ProviderContext`, `ProviderOptions`, `selectProviders`, `runProviderSearch`, `providerCacheKey`;
- `SearchInput.sources` and the MCP `sources` parameter;
- **`NormalizedQuery.providerOptions`**: provider code keeps reading its own options from `q.providerOptions`.

#### `Reference` is a type alias of a union

- **`Omit`.** `Omit<Reference, K>` loses the link between `modality` and its fields. Use a distributive omit:

  ```ts
  type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
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
