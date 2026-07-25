# @refkit/provider-nailbook

## 0.1.0

### Minor Changes

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
