# @refkit/mcp

## 0.7.0

### Minor Changes

- b5bbba8: `REFKIT_MAX_CURSOR_SEEN` env var for the zero-config CLI: caps how many
  already-returned keys the load-more cursor remembers (core's `maxCursorSeen`),
  for hosts that clamp tool-output strings — the default 500-key cursor is ~2.7k
  chars; `REFKIT_MAX_CURSOR_SEEN=200` brings it near ~1.1k. Invalid values warn
  on stderr and fall back to the core default.
- 17469ad: New keyless provider `@refkit/provider-nailbook` — image references from Nailbook
  (nailbook.jp), a large Japanese nail-design catalog. Recall is best with Japanese tag
  words (マグネット, ニュアンス, ちゅるん…). Results are discovery-class: no per-item
  license metadata, so each carries `license: 'unknown'` + `rehostPolicy: 'thumbnail-only'`
  and gates to `needs-review` (never auto-allowed) — surface the CDN thumbnail only, never
  rehost the original.

  Rather than scraping the client-rendered `/design/` list HTML (whose embedded bootstrap
  carries photo IDs but no image URLs), the provider calls the same JSON endpoint the site's
  own frontend uses (`POST /api/web/photo/search`), returning full photo objects in one
  request. Each `search()` makes exactly one request with no multi-page fan-out.

  `@refkit/mcp` boots Nailbook in its zero-config keyless default set.

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

### Patch Changes

- Updated dependencies [b5bbba8]
- Updated dependencies [17469ad]
- Updated dependencies [aa4b048]
  - @refkit/core@0.8.0
  - @refkit/provider-nailbook@0.1.0
  - @refkit/provider-artic@0.2.5
  - @refkit/provider-gutendex@0.2.6
  - @refkit/provider-internet-archive@0.3.3
  - @refkit/provider-met@0.2.5
  - @refkit/provider-openverse@0.3.3
  - @refkit/provider-poetrydb@0.2.5
  - @refkit/provider-polyhaven@0.2.4
  - @refkit/provider-rijksmuseum@0.2.4
  - @refkit/provider-wikimedia-commons@0.3.3

## 0.6.1

### Patch Changes

- Updated dependencies [d6432a1]
  - @refkit/provider-gutendex@0.2.5
  - @refkit/provider-artic@0.2.4
  - @refkit/provider-internet-archive@0.3.2
  - @refkit/provider-met@0.2.4
  - @refkit/provider-openverse@0.3.2
  - @refkit/provider-poetrydb@0.2.4
  - @refkit/provider-polyhaven@0.2.3
  - @refkit/provider-rijksmuseum@0.2.3
  - @refkit/provider-wikimedia-commons@0.3.2

## 0.6.0

### Minor Changes

- 3cce5e3: - `search_references` gains `rerank: true` (query-aware re-ranking via `lexicalReranker`, CJK-aware) and `cursor` (load-more pagination with cross-page dedup; the continuation token is returned as top-level `nextCursor` on every call, independent of `explain`).
  - BYOK provider packages are explicitly externalized from the tsup bundle so dynamic imports resolve from node_modules at runtime — `--omit=optional` actually omits them, and provider patch releases reach `@refkit/mcp` users without a republish.
  - BYOK provider packages moved from `dependencies` to `optionalDependencies` and are now loaded lazily, only when their key is present. Default installs (incl. `npx -y @refkit/mcp`) still get everything; installs with `--omit=optional` skip BYOK sources, and a key whose package is missing logs a stderr warning instead of crashing. `defaultProviders()` is now async.

### Patch Changes

- Updated dependencies [3cce5e3]
- Updated dependencies [3cce5e3]
  - @refkit/core@0.7.0
  - @refkit/provider-openverse@0.3.2
  - @refkit/provider-internet-archive@0.3.2
  - @refkit/provider-wikimedia-commons@0.3.2
  - @refkit/provider-artic@0.2.4
  - @refkit/provider-met@0.2.4
  - @refkit/provider-polyhaven@0.2.3
  - @refkit/provider-gutendex@0.2.4
  - @refkit/provider-poetrydb@0.2.4
  - @refkit/provider-rijksmuseum@0.2.3

## 0.5.1

### Patch Changes

- 5b50432: Repo moved to the refkitjs GitHub org: add `repository` (with per-package `directory`), `homepage`, and `bugs` metadata to every public package, and point the gutendex default User-Agent at github.com/refkitjs/refkit.
- Updated dependencies [5b50432]
  - @refkit/core@0.6.1
  - @refkit/provider-artic@0.2.3
  - @refkit/provider-brave@0.2.3
  - @refkit/provider-europeana@0.3.1
  - @refkit/provider-flickr@0.3.1
  - @refkit/provider-freesound@0.3.1
  - @refkit/provider-gutendex@0.2.3
  - @refkit/provider-internet-archive@0.3.1
  - @refkit/provider-jamendo@0.3.1
  - @refkit/provider-met@0.2.3
  - @refkit/provider-openverse@0.3.1
  - @refkit/provider-pexels@0.2.3
  - @refkit/provider-pixabay@0.2.3
  - @refkit/provider-poetrydb@0.2.3
  - @refkit/provider-polyhaven@0.2.2
  - @refkit/provider-rijksmuseum@0.2.2
  - @refkit/provider-smithsonian@0.2.3
  - @refkit/provider-unsplash@0.2.3
  - @refkit/provider-wikimedia-commons@0.3.1

## 0.5.0

### Minor Changes

- 6a9b7e9: New stateless `evaluate_use` and `build_attribution` MCP tools — evaluate a
  license against an intended use, or build an attribution credit line, without a
  search round-trip. Zero-config `defaultProviders` now reads unified
  `REFKIT_<PROVIDER>_KEY` env names first (`REFKIT_UNSPLASH_KEY`,
  `REFKIT_PEXELS_KEY`, `REFKIT_PIXABAY_KEY`, `REFKIT_FLICKR_KEY`,
  `REFKIT_SMITHSONIAN_KEY`, `REFKIT_BRAVE_KEY`, `REFKIT_FREESOUND_KEY`,
  `REFKIT_JAMENDO_CLIENT_ID`, `REFKIT_EUROPEANA_KEY`), falling back to the legacy
  names (`UNSPLASH_KEY`, `PEXELS_KEY`, `PIXABAY_KEY`, `FLICKR_KEY`, `SI_KEY`,
  `BRAVE_TOKEN`, `FREESOUND_TOKEN`, `JAMENDO_CLIENT_ID`, `EUROPEANA_KEY`), which
  are still honored.
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

### Patch Changes

- Updated dependencies [991d467]
- Updated dependencies [8300c18]
- Updated dependencies [c6b6061]
  - @refkit/core@0.6.0
  - @refkit/provider-openverse@0.3.0
  - @refkit/provider-flickr@0.3.0
  - @refkit/provider-wikimedia-commons@0.3.0
  - @refkit/provider-freesound@0.3.0
  - @refkit/provider-jamendo@0.3.0
  - @refkit/provider-europeana@0.3.0
  - @refkit/provider-internet-archive@0.3.0
  - @refkit/provider-artic@0.2.2
  - @refkit/provider-brave@0.2.2
  - @refkit/provider-gutendex@0.2.2
  - @refkit/provider-met@0.2.2
  - @refkit/provider-pexels@0.2.2
  - @refkit/provider-pixabay@0.2.2
  - @refkit/provider-poetrydb@0.2.2
  - @refkit/provider-polyhaven@0.2.1
  - @refkit/provider-rijksmuseum@0.2.1
  - @refkit/provider-smithsonian@0.2.2
  - @refkit/provider-unsplash@0.2.2

## 0.4.0

### Minor Changes

- 2b16960: Add @refkit/provider-rijksmuseum: Rijksmuseum as license-normalized image references (keyless; CC0 / Public Domain).

  Register the P1 providers in the @refkit/mcp zero-config server — rijksmuseum, polyhaven, ambientCG and internet-archive (keyless); freesound, jamendo and europeana (when their API key/token is set).

### Patch Changes

- Updated dependencies [2b16960]
- Updated dependencies [2b16960]
- Updated dependencies [2b16960]
- Updated dependencies [2b16960]
- Updated dependencies [2b16960]
- Updated dependencies [2b16960]
- Updated dependencies [2b16960]
  - @refkit/provider-europeana@0.2.0
  - @refkit/provider-freesound@0.2.0
  - @refkit/core@0.5.0
  - @refkit/provider-met@0.2.1
  - @refkit/provider-artic@0.2.1
  - @refkit/provider-openverse@0.2.1
  - @refkit/provider-unsplash@0.2.1
  - @refkit/provider-pexels@0.2.1
  - @refkit/provider-pixabay@0.2.1
  - @refkit/provider-gutendex@0.2.1
  - @refkit/provider-smithsonian@0.2.1
  - @refkit/provider-brave@0.2.1
  - @refkit/provider-flickr@0.2.1
  - @refkit/provider-wikimedia-commons@0.2.1
  - @refkit/provider-internet-archive@0.2.0
  - @refkit/provider-jamendo@0.2.0
  - @refkit/provider-polyhaven@0.2.0
  - @refkit/provider-rijksmuseum@0.2.0
  - @refkit/provider-poetrydb@0.2.1

## 0.3.0

### Minor Changes

- 8c221f8: Add unified search controls, provider capability metadata, MCP controls input, search metadata/explanations, practical provider-specific `providerOptions` whitelists, and a core duplicate hook for agent-facing searches.

### Patch Changes

- Updated dependencies [8c221f8]
  - @refkit/core@0.4.0
  - @refkit/provider-unsplash@0.2.0
  - @refkit/provider-pexels@0.2.0
  - @refkit/provider-pixabay@0.2.0
  - @refkit/provider-flickr@0.2.0
  - @refkit/provider-brave@0.2.0
  - @refkit/provider-openverse@0.2.0
  - @refkit/provider-gutendex@0.2.0
  - @refkit/provider-poetrydb@0.2.0
  - @refkit/provider-wikimedia-commons@0.2.0
  - @refkit/provider-met@0.2.0
  - @refkit/provider-artic@0.2.0
  - @refkit/provider-smithsonian@0.2.0

## 0.2.0

### Minor Changes

- 451271b: - Zero-config `npx @refkit/mcp` server: a `bin` that boots with the keyless providers plus any BYOK provider whose key is in the environment — no host code.
  - Expose the use-verdict + attribution at the agent boundary: a new `intent` param annotates each result with `{ decision, reason, confidence }` (+ a ready-to-use attribution credit line) without filtering; `gateFor` still filters.
  - Report the real package version in the MCP `initialize` handshake (was hardcoded `0.0.0`).

### Patch Changes

- Updated dependencies [451271b]
- Updated dependencies [fa930f9]
  - @refkit/core@0.3.0
  - @refkit/provider-artic@0.1.2
  - @refkit/provider-brave@0.1.2
  - @refkit/provider-flickr@0.1.2
  - @refkit/provider-gutendex@0.1.2
  - @refkit/provider-met@0.1.2
  - @refkit/provider-openverse@0.1.2
  - @refkit/provider-pexels@0.1.2
  - @refkit/provider-pixabay@0.1.2
  - @refkit/provider-poetrydb@0.1.2
  - @refkit/provider-smithsonian@0.1.2
  - @refkit/provider-unsplash@0.1.2
  - @refkit/provider-wikimedia-commons@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [5e27c09]
  - @refkit/core@0.2.0
