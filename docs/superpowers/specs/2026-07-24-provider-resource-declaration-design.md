# Provider Resource Declaration Design

## Goal

Let every provider declare *what it provides* at two granularities — coarse `modalities`
(existing, closed enum) and fine `kinds` (new, open vocabulary) — plus a one-line content
`description`. Core routes queries by these declarations (skipping providers that cannot
have the requested resource), and the MCP server collects them at startup into its tool
schema and description so an LLM can fill the classification parameters and pick sources.

## Scope

Three layers plus two approved extensions:

- **Layer 0 — declarations (core types):** open `ResourceKind` vocabulary; optional
  `kinds` and `description` on `ReferenceProvider`; optional `kind` on `Reference`;
  widen `SearchControls.media.kind` from the closed five-value enum to `ResourceKind`.
- **Layer 1 — core routing:** extend provider selection to honor `kinds`; new skip
  reasons in explain metadata; new `providers` (id whitelist) search input.
- **Layer 2 — MCP dynamic exposure:** derive the `modalities` / `media.kind` /
  `providers` schemas and a per-provider source list in the tool description from the
  registered providers at `createRefkitMcpServer` time.
- **Extension 1:** `ReferenceProvider.description` — one-line content-domain summary,
  surfaced in the MCP source list so the LLM can judge topical fit.
- **Extension 2:** `providers?: string[]` search input — explicit source subset
  selection, exposed as an MCP parameter with a dynamic id enum.

Non-goals: no change to the `Modality` enum; no statistical / learned routing; no
negative caching (can layer on later without schema changes).

## Layer 0 — Declarations

In `packages/core/src/provider.ts`:

```ts
export type WellKnownKind =
  | 'photo' | 'illustration' | 'vector' | 'icon' | 'artwork'
  | 'texture' | 'hdri' | '3d-model'
  | 'film' | 'animation'
  | 'music' | 'sound-effect'
  | 'ebook' | 'poem'
export type ResourceKind = WellKnownKind | (string & {})
```

`ResourceKind` is an **open** vocabulary: the union keeps autocomplete for well-known
values while `(string & {})` admits any custom kind a third-party provider invents.
Well-known values are hints, not validation — nothing in core rejects unknown kinds.

`ReferenceProvider` gains two optional fields:

```ts
kinds?: readonly ResourceKind[]   // what fine-grained kinds this provider offers
description?: string              // one-line content-domain summary, e.g.
                                  // "Dutch Golden Age art from the Rijksmuseum"
```

`Reference` gains `kind?: string` (zod: `z.string().optional()` in
`packages/core/src/reference.ts`) so results can carry their fine-grained kind.

`SearchMediaControls.kind` widens from
`'photo' | 'illustration' | 'vector' | 'film' | 'animation'` to `ResourceKind`. This is
a type-level widening — every previously valid value stays valid.

**Declarations vs. controls are orthogonal:** `kinds` states what a provider *offers*
(routing: whether to query it at all); the `media.kind` entry in `capabilities.controls`
states that a provider can *filter* its own content by kind (translation: whether to
forward the filter upstream, e.g. pixabay's `image_type`). A single-kind provider like
polyhaven declares `kinds: ['texture']` and never needs the control.

## Layer 1 — Core Routing

Provider selection in `client.ts` (currently modality-intersection only) becomes, in
order:

1. **Id whitelist** — if `input.providers` is set, keep only providers whose `id` is in
   it. Unknown ids append a warning to `meta.warnings` (LLMs and humans typo; valid
   remainder still runs).
2. **Modality intersection** — unchanged.
3. **Kind match** — if `input.controls.media.kind` is set: keep providers that either
   do **not** declare `kinds` (conservative inclusion, same progressive philosophy as
   `capabilities` in `query.ts`) or declare a `kinds` array containing the requested
   value.

If selection ends empty, throw — extending the existing
`refkit.search: no registered provider supports …` error with the reason (whitelist,
modality, or kind).

`SearchMeta.providers[].reason` gains two values alongside `'unsupported-modality'`:
`'not-selected'` (excluded by the id whitelist) and `'unsupported-kind'`. Every
registered provider still appears in `meta.providers`, so explain output shows exactly
who was skipped and why.

`SearchInput` gains `providers?: readonly string[]`.

## Layer 2 — MCP Dynamic Exposure

`createRefkitMcpServer(refkit)` already receives the configured client and
`refkit.providers` is public — all data below is read from provider declarations at
server construction; there is no second registry to maintain.

- **`modalities` parameter:** dynamic `z.enum` over the union of registered providers'
  `modalities`. (Also fixes today's failure mode where the LLM picks a modality no
  registered provider supports and the search throws.)
- **`controls.media.kind` parameter:** dynamic `z.enum` over (union of declared
  `kinds`) ∪ (the five legacy control values `photo / illustration / vector / film /
  animation`). The legacy values stay because they remain meaningful as upstream
  filter translations for providers that support the `media.kind` control but do not
  declare `kinds`; including them also keeps the schema a superset of today's.
- **`providers` parameter:** `z.array(z.enum(registeredProviderIds))` — a closed enum
  is correct here because the registered set *is* the universe.
- **Tool description source list:** appended to the `search_references` description,
  one provider per line, generated as
  `id (modality[/modality]·kind[,kind]): description`; kinds segment omitted when
  undeclared, description omitted when absent. Example:

  ```
  Configured sources:
  - unsplash (image·photo): high-quality stock photography
  - pixabay (image·photo,illustration,vector): free stock images
  - polyhaven (image·texture): CC0 PBR textures for 3D work
  - freesound (audio·sound-effect): collaborative sound-effect archive
  ```

- **Meta schema sync:** the `reason` enum in the MCP `searchMetaSchema` adds
  `'not-selected'` and `'unsupported-kind'`.

## Provider Declarations (this iteration)

All first-party providers gain a `description`. `kinds` is declared where accurate;
broad/aggregator sources stay undeclared (conservative inclusion is the honest
answer):

| Provider | kinds | Rationale |
|---|---|---|
| unsplash, pexels-image, flickr | `['photo']` | photo-only sources |
| pixabay-image | `['photo','illustration','vector']` | matches its `image_type` filter |
| pexels-video | `['film']` | live-action stock video |
| pixabay-video | `['film','animation']` | matches its video types |
| polyhaven | `['texture']` or `['hdri']` per `assetType` config | factory-computed |
| ambientcg | `['texture']` | PBR materials only |
| met, artic, rijksmuseum, smithsonian, europeana | `['artwork']` | museum/heritage collections |
| freesound | `['sound-effect']` | effects archive |
| jamendo | `['music']` | music platform |
| openverse-audio | `['music','sound-effect']` | aggregates both |
| gutendex | `['ebook']` | Project Gutenberg |
| poetrydb | `['poem']` | poems only |
| internet-archive | `['film','ebook']` | maps its two modalities |
| brave, wikimedia-commons, openverse-image | *undeclared* | open-web / omnibus content |

**Result annotation:** single-kind providers stamp their kind on every `Reference`
statically. pixabay maps the upstream `type` field per item. Multi-kind providers
without upstream type data leave `kind` unset.

**Testkit:** `provider-testkit` adds one conformance check — when a provider declares
non-empty `kinds` and a returned reference carries `kind`, that value must be in the
declared set.

## Backward Compatibility

Every new field is optional; undeclared third-party providers behave exactly as today
(conservative inclusion on kind-filtered queries). `media.kind` widening and the MCP
dynamic enums are supersets of current accepted values. The `reason` enum extension is
additive (a `minor` for `@refkit/core` and `@refkit/mcp`; provider packages get a
`minor` for the new declarations).

## Error Handling

Unknown ids in `providers` warn and continue; an empty selection after filtering
throws with the narrowing reason. No change to provider-level error semantics.

## Verification

TDD per production change. Core: selection-predicate units (kind match, undeclared
inclusion, whitelist, unknown-id warning, empty-selection error). MCP: construct a
server over two fake providers and assert the generated description contains the
source list and the dynamic enums carry the expected values. Final gate:
`pnpm typecheck`, `pnpm test:run`, `pnpm build`.
