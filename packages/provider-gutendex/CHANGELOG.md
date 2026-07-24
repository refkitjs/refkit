# @refkit/provider-gutendex

## 0.2.6

### Patch Changes

- Updated dependencies [b5bbba8]
- Updated dependencies [aa4b048]
  - @refkit/core@0.8.0

## 0.2.5

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

## 0.2.4

### Patch Changes

- Updated dependencies [3cce5e3]
  - @refkit/core@0.7.0

## 0.2.3

### Patch Changes

- 5b50432: Repo moved to the refkitjs GitHub org: add `repository` (with per-package `directory`), `homepage`, and `bugs` metadata to every public package, and point the gutendex default User-Agent at github.com/refkitjs/refkit.
- Updated dependencies [5b50432]
  - @refkit/core@0.6.1

## 0.2.2

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
