# @refkit/provider-testkit

## 0.1.1

### Patch Changes

- Updated dependencies [4dfd41a]
  - @refkit/core@0.9.0

## 0.1.0

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

## 0.0.4

### Patch Changes

- d6432a1: Stop the weekly live-smoke from crying wolf on WAF blocks: `liveSmoke` gains an
  opt-in `tolerateUpstreamBlock` that skips (with a warning) when the source's WAF
  returns HTTP 403 from the runner's datacenter IP — 404s, 5xx, schema changes,
  and empty results still fail. Applied to gutendex only, whose Cloudflare front
  blocks GitHub Actions IPs regardless of User-Agent (verified with both a
  descriptive bot UA and a browser UA). gutendex requests also send an explicit
  `Accept: application/json` now.

  gutendex additionally gains a `baseUrl` config: the upstream docs frame
  gutendex.com as a test instance ("You should run your own server, but you can
  test queries at gutendex.com"), so production/datacenter consumers can now
  point the provider at a self-hosted Gutendex.

## 0.0.3

### Patch Changes

- Updated dependencies [3cce5e3]
  - @refkit/core@0.7.0

## 0.0.2

### Patch Changes

- Updated dependencies [5b50432]
  - @refkit/core@0.6.1

## 0.0.1

### Patch Changes

- Updated dependencies [991d467]
- Updated dependencies [8300c18]
- Updated dependencies [c6b6061]
  - @refkit/core@0.6.0
