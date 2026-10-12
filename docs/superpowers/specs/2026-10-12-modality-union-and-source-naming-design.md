# Reference by modality, one word for "source" — design spec

Status: decided by the controller under the user's delegation ("按你的优先级来做吧", 2026-10-12). This covers items 10 and 11 of the 2026-09 architecture review. Research with file:line evidence is in the session scratchpad (`major-research.md`); the facts this spec relies on are restated here.

Release: one changeset lists `@refkit/core`, `@refkit/mcp` and all 19 `@refkit/provider-*` packages as `minor` (0.x breaking, as `4dfd41a` did); `@refkit/provider-testkit` is private and needs none. Providers pin core exactly when published, so hosts upgrade core and every provider together; a provider released only by a forced patch would leak its behaviour change into dsh 0.2.0's caret ranges, which is why every provider gets a minor. Preferably this ships in the same Version Packages PR as #33's changeset (core 0.9.0 → 0.10.0 once); if #33 has already shipped alone, this release is 0.11.0 and nothing else changes. Then a lockstep `@refkit/dsh-plugin` 0.3.0 (separate repo, D8). This builds on #33 (`REHOST_POLICIES`, agent-ref fields).

## Why

- **Item 10.** `EmittedReference`/`Reference` is one flat shape: any modality may carry `visual`, `text` or `preview`, and nothing says which belong together. Audio and video have no metadata at all, although every audio and video API returns a duration. Freesound even requests `duration` and drops it.
- **Item 11.** One concept, "the catalog a search queries" (`provider.id`, e.g. `openverse-audio`), has three names: callers pass `sources`, results report `meta.providers[].providerId`, options are `providerOptions`, errors go to `onProviderError`, and each reference names it `source.providerId`. Every user-facing surface (MCP params, dsh config and copy, READMEs) already says "source".

## Goals

1. A `Reference` type whose variants say which metadata fits which modality, with the type system catching a provider that writes the wrong field.
2. Duration and audio/video metadata filled wherever the existing responses already carry them (no extra requests).
3. One vocabulary: a **provider** is adapter code; each provider instance serves one **source**, whose id is what callers pick and what results report.
4. Fix the defects the research found in the same files (listed under D6).

## Non-goals

- No change to the MCP `sources` param or the dsh `sources` config field (stored user configs and learned agent calls keep working).
- No new upstream requests (no Freesound `FIELDS` expansion, no Internet Archive per-item metadata calls, no Flickr `o_dims`).
- No change to ranking weights, the use-gate, license facts or attribution.
- The other review leftovers (Wikimedia housekeeping categories, deadline/`withDefaultUserAgent`/controls-boundary test gaps, the AggregateError → deadline error, the three one-line nits) stay out of this release.

## Decisions

### D1 — Variants (core `reference.ts`)

Common to every variant: `modality` (discriminant), `kind?`, `title?`, `description?`, `tags?`, `sourceUrl` / `canonicalUrl?` (emitted) or `canonicalUrl` (complete), `rights`, `thumbnail?`, `sourceScore?`, `raw?`, plus the core-stamped `id`, `source`, `verifiedAt`, `relevance`.

- `thumbnail` stays common and is documented as **an image a UI can show**: the picture itself, a video poster, audio cover art or a book cover. It must never be a non-image URL.

| Variant | Own fields |
|---|---|
| `image` | `preview?: MediaPreview` (mediaType `image/*`), `visual?: VisualMeta`, `perceptualHash?` |
| `video` | `preview?: MediaPreview` (mediaType `video/*`), `visual?: VisualMeta` (source dimensions), `video?: VideoMeta` |
| `audio` | `preview?: MediaPreview` (mediaType `audio/*`), `audio?: AudioMeta` |
| `text` | `text?: TextMeta` |

New types:

```ts
export interface VideoMeta { durationSec?: number; fps?: number }
export interface AudioMeta { durationSec?: number; bitrateKbps?: number; sampleRateHz?: number; channels?: number; format?: string }
```

- **Units.** Durations are seconds as a float (Freesound reports `2.5`); Openverse's milliseconds are divided by 1000. Bitrate is kbps; Openverse's bps are divided by 1000.
- **`visual` means the original's dimensions** for image and video. An emitter that only knows a rendition's size leaves `visual` unset (D6.8).

### D2 — TypeScript shape: a soft union

- Each variant is an interface; the fields of the other variants are declared `?: never` on it. Writers get the wrong-field error that is the point of item 10. Readers such as `refText`, `lexicalHit`, `qualityScores`, MCP `toAgentRef` and the dsh `toTile` keep compiling: `r.visual` is `VisualMeta | undefined` on the union. Fixture builders that spread a `Partial<Reference>` / `Partial<EmittedReference>` over an image default do not compile (core `client.test.ts:1059`, `confidence.test.ts:7`, `dedup.test.ts:5`, `rerank.test.ts:6`, testkit `testkit.test.ts:7`, dsh `tests/search.test.ts:9`): retype their override parameter to `Partial<ImageReference>` / `Partial<EmittedImageReference>`.
- Exported types: `ImageReference`, `VideoReference`, `AudioReference`, `TextReference` and their `Emitted…` counterparts; `EmittedReference` and `Reference` become union type aliases. `VideoMeta` and `AudioMeta` are new exports. `ReferenceMedia`, `MediaPreview`, `VisualMeta` and `TextMeta` stay.
- `Reference` can no longer use `interface … extends Omit<…>`. It is built per variant: the emitted variant minus `sourceUrl`/`canonicalUrl`, plus the core-stamped fields. `completeReference` must keep the discriminant through its rest-spread; verify by type tests.
- A strict union (fields absent on other variants) is rejected: 8 more code edits and about 16 more test reads, on top of the 6 fixture-builder retypes both options need, for no extra safety on the emit side.
- Consequences for hosts, stated in the changeset: `Reference` is a type alias, so it can no longer be augmented by declaration merging, and `Omit<Reference, K>` in host code collapses to the common keys (use a distributive omit).

### D3 — Runtime schemas

- `emittedReferenceSchema` and `referenceSchema` become `z.discriminatedUnion('modality', …)` over the four variants, built from one table (`satisfies Record<Modality, z.ZodRawShape>`) by a generic `variant(m, tail)` helper called once per modality in an explicit tuple (`MODALITIES.map` does not type-check as a non-empty tuple). A type test asserts `EmittedReference['modality']` is exactly `Modality`, so a new modality cannot be half-added.
- `preview.mediaType` must start with the variant's prefix (`image/`, `video/`, `audio/`). A mismatch rejects the item at the boundary, like any other malformed item.
- Unknown keys are **stripped** (default `z.object`). Rejecting the whole item would be too harsh at a boundary built to drop single bad items. The provider testkit instead asserts that `parseEmitted(item)` lost no keys (top-level keys and the keys of nested known objects, skipping `raw`), so a provider writing a cross-modality field fails its own conformance tests.
- The cache key prefix goes `refkit:v3` → `refkit:v4`, so entries written in the old shape are missed rather than parsed: with `source.providerId` renamed to `source.id` (D4), every old item would otherwise fail `parseReference`, be counted as rejected and empty the search for the TTL. The bump is required.
- The zod output types must stay assignable to the TS types (`z.ZodType<EmittedReference>` / `z.ZodType<Reference>`), as today.

### D4 — Naming: scheme B

Rule (goes into the core README as a two-line glossary): *A provider is adapter code (a `ReferenceProvider` from a `@refkit/provider-*` package). Each provider instance serves one source, whose id (`provider.id`) is what `sources`, `sourceOptions` and `meta.sources` speak.*

| Package | Old | New |
|---|---|---|
| core meta | `SearchMeta.providers` | `sources` |
| core meta | `ProviderSearchStatus` (`providerId`), `providerSearchStatusSchema` | `SourceStatus` (`sourceId`), `sourceStatusSchema` |
| core meta | `controls.appliedByProvider` / `ignoredByProvider` | `appliedBySource` / `ignoredBySource` |
| core meta | `SearchMeta.providerOptions` | `sourceOptions` |
| core skip vocab | `PROVIDER_SKIP_REASONS`, `ProviderSkipReason` | `SOURCE_SKIP_REASONS`, `SourceSkipReason` (values unchanged) |
| core input | `SearchInput.providerOptions`, `ProviderOptionsById` | `sourceOptions`, `SourceOptionsById` |
| core input | `onProviderError`, `ProviderError { providerId }` | `onSourceError`, `SourceError { sourceId }` |
| core reference | `Reference.source { providerId, sourceUrl }` | `source { id, url }` |
| core pipeline (exported) | `PassDeps.onProviderError`, `PassDeps.providerOptions`, `PassOutcome.statusByProvider`, `normalizeQuery` input `providerOptions` | `onSourceError`, `sourceOptions`, `statusBySource`, `sourceOptions` |
| core messages | "no configured provider matches source id(s)", "no registered provider supports modalities", "all providers failed", "n provider(s) failed" | "no configured source matches id(s)", "no configured source supports modalities", "all sources failed", "n source(s) failed" |
| mcp input | `providerOptions` | `sourceOptions` |
| mcp output | agent ref `provider` | `source` |

Unchanged on purpose: `RefkitOptions.providers`, `RefkitClient.providers`, `PassDeps.providers`, `ProviderSelection`, `providerCacheKey`, `ProviderRun`, `ProviderRunDeps`, `ReferenceProvider`, `defineProvider`, `ProviderContext`, `ProviderCapabilities`, `ProviderOptions`, `ProviderOptionValue`, **`NormalizedQuery.providerOptions`** (adapter side: "this provider's own options"; the 19 packages keep reading it), `selectProviders`, `runProviderSearch`, `SearchInput.sources`, `sourceConfidence`, `sourceDiversity`, `sourceScore`, package and factory names, `XxxSearchOptions`, the MCP `sources` param, the MCP CLI env names.

Positional parameters named `providerId` (e.g. `completeReference`, `referenceId`) are renamed `sourceId` (not breaking).

### D5 — Metadata filled in this release (no extra requests)

| Source | Field | From |
|---|---|---|
| openverse-audio | `audio.durationSec` | `duration` ms / 1000 |
| openverse-audio | `audio.bitrateKbps`, `audio.sampleRateHz`, `audio.format` | `bit_rate` / 1000 (null for Jamendo-sourced items), `sample_rate` (often null), `filetype` only when it is a key of `AUDIO_MIME`, with Jamendo's `mp31`/`mp32` codes normalised to `mp3` |
| freesound | `audio.durationSec` | `duration` (already requested) |
| jamendo | `audio.durationSec` | `duration` (verify it is in the response; add to the typed interface) |
| pexels-video | `video.durationSec` | `duration` |
| pixabay-video | `video.durationSec` | `duration` |

Null or non-finite upstream values leave the field unset. Internet Archive's `runtime` is skipped (sparse, ambiguous forms).

### D6 — Defects fixed in the same release

1. **openverse-audio thumbnail is JSON.** It points at the `waveform` endpoint (`application/json` peak data). Use the upstream `thumbnail` (album art) instead, unset when null; drop the waveform. The fixture that pins the waveform URL changes.
2. **Modality leaks.**
   - Internet Archive ignores `q.modalities` and always asks for `movies OR texts`; derive the mediatype filter from the requested modalities (`movies` for video, `texts` for text; when `q.modalities` contains neither, return `[]` without a request).
   - Core (`runProviderSearch`, live path) counts an emitted item whose `modality` is not in `query.modalities` (the per-source normalized query, i.e. `SearchInput.modalities ∩ provider.modalities`) as **rejected**, the same path as a malformed item: it is counted in `rejected` and fires `onSourceError`. Selection already throws on an empty `modalities`, so the list is never empty through `createRefkit`. Cached entries were checked when written. Update the `rejected` doc on `SourceStatus`.
   - The testkit asserts `ref.modality ∈ provider.modalities`.
3. **Duplicate source ids pass silently.**
   - `createRefkit` throws when two providers share an id.
   - `polyhaven({ assetType: 'hdris' })` gets the id `polyhaven-hdri`, so textures and HDRIs can coexist. This is breaking for HDRI users (reference ids, cache keys, `sources`/`sourceOptions` keys change) and the changeset says so.
4. **Typed selection error.** Export `SourceSelectionError` for both selection throws: `code: 'no-matching-source'` when `sources` was given and nothing was chosen (unknown id, known id lacking the modality or kind, or `sources: []`), `'no-source-for-query'` otherwise; fields `requested?: string[]` (the `sources` as passed), `unknown: string[]` (ids that match no configured source), `modalities: Modality[]`, `kind?: string`. The dsh plugin stops string-matching core's message, which this release changes anyway.
5. **Declared kinds that are never emitted.**
   - pixabay-video: `kind` from the upstream `type` (`film` / `animation`).
   - openverse-audio: `kind` from the upstream `category` when it maps to `music` or `sound-effect`. The implementer verifies the field and its values live (keyless). Expect only `music` (Jamendo-sourced items); Freesound-sourced items carry `category: null`.
6. **Unknown ids in `sourceOptions`** produce a warning, as unknown ids in `sources` already do.
7. **Testkit per-item rules.** The preview `mediaType` prefix is enforced by D3's schema, so the testkit drops its own check (`testkit.test.ts:63-67` now expects the `failed emittedReferenceSchema` message). The thumbnail landing-page rule runs per item for every modality, not only when `provider.modalities` includes `image`.
8. **`visual` semantics.** Flickr (≤1024px rendition) and pixabay-video (first available rendition) stop setting `visual`; the rendition size stays on `preview`. Pins `flickr.test.ts:59` and `pixabay.test.ts:134` change. pixabay-video also skips a rendition whose `url` is empty or whose size is 0 when choosing the preview (vendor docs say an absent `large` comes back that way).

### D7 — `@refkit/mcp`

- Renames per D4: `sourceOptions` input, agent ref `source`. No alias for `providerOptions` (no shims; nobody depends on it yet) — see Risks.
- The agent ref gains optional `durationSec` (from `audio`/`video`) and `width`/`height` (from `visual`, else from `preview.width/height`: aspect ratio is rendition-independent), so agents can filter by length or resolution. It stays a flat projection; the output schema does not become a union.
- The "unknown sources" tool error is detected through `SourceSelectionError` with `code === 'no-matching-source'`, not a message heuristic. Other errors raised while `sources` is set (e.g. an invalid cursor) now throw instead of becoming an `isError` result.

### D8 — `@refkit/dsh-plugin` 0.3.0 (separate repo, after the refkit packages are on npm)

- Dependencies move to the new core and provider versions (the `^0.9` range does not admit the new minor): core `^0.10.0` (or `^0.11.0` if #33 shipped alone) and every provider at its new minor.
- Add a `polyhaven-hdri` source (the tool description already advertises HDRIs): append it to `SHIPPED_IDS`/`EXPECTED_IDS`, mirror it in `SOURCE_IDS`, and update the "23 sources" copy to 24.
- dsh already exports its own `SourceStatus` (a different shape); alias the core import. Renaming the public `PROVIDER_IDS` export is breaking for the plugin's API and goes in its changelog.
- Adapt to D4:
  - read `meta.sources`, `sourceId` and `onSourceError`;
  - detect the selection miss with `SourceSelectionError`.
- Naming inside the plugin:
  - the host's `PROVIDER_IDS` becomes `SOURCE_IDS` and `RETIRED_IDS` becomes `RETIRED_SOURCE_IDS`, matching the client mirror;
  - copy that says "provider ids" says "source ids" (dsh uses "provider" for LLM providers);
  - the `sources` config field, tool param and output `sources[]` stay.
- The tile's `provider` key becomes `source`. `narrowTile` accepts either key for one release, so cards persisted in old conversations still render.
- The tile gains `durationSec`, and its `width`/`height` fall back to `preview.width/height` when `visual` is unset. Audio and video tiles show the duration as a small `m:ss` badge.
- Video tiles render their poster (`thumbnail`) with a ▶ overlay instead of a bare glyph.
- The `refkit_search` tool output schema follows (additive `durationSec`; `provider` → `source`).

## Testing

- **Core.**
  - Type tests: each variant rejects another variant's field (`@ts-expect-error`); `completeReference` keeps the discriminant.
  - Schema tests: each variant parses; a wrong preview prefix rejects; a cross-modality field is stripped.
  - A modality outside the query is counted as rejected.
  - Duplicate ids throw.
  - `SourceSelectionError` carries its code and ids.
  - Unknown `sourceOptions` ids warn.
  - The cache key is `v4`.
- **Providers.** Fixture tests for every D5 field and every D6 fix. Keyless live checks: openverse-audio duration, bitrate, kind and album art; Internet Archive text-only. The full live smoke runs with `REFKIT_LIVE=1`.
- **MCP.** Renamed input and output; `durationSec`/`width`/`height` projected; selection error path.
- **Providers, pinned tests that change.** IA's query-escaping test (`internet-archive.test.ts:194-198`, `mediatype:(movies)` for a video-only query), openverse's waveform pin, flickr and pixabay-video `visual` pins, the testkit preview test.
- **Sweep.** Grep READMEs, docstrings and `scripts/` (e.g. `scripts/build-hero.mts`) for every D4 old name.
- **Gate.** `pnpm typecheck && pnpm lint && pnpm build && pnpm test:run && pnpm smoke:artifact` clean.
- **dsh 0.3.0.** Its gate, plus live acceptance in the local dsh web profile:
  - an audio search shows durations and album art;
  - a video search shows posters;
  - a persisted 0.2.0 card still renders.

## Risks

- Downstream code that reads `meta.providers`, `ref.source.providerId` or `onProviderError` breaks at compile time. That is intended for a breaking minor; the changesets spell out each rename.
- MCP callers that still send `providerOptions` have it silently stripped by the MCP SDK (it strips unknown input keys). Accepted: no known users, and the tool schema advertises `sourceOptions`.
- Stripping unknown keys could hide a provider bug in production. The testkit's lost-keys assertion catches it in each provider's own tests.
- Some D5 and D6 fields come from keyed APIs that cannot be checked live here (freesound, jamendo, pexels, pixabay). They are taken from fixtures and vendor docs and are optional, so a wrong guess leaves the field unset rather than failing.
