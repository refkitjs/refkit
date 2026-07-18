# @refkit/provider-testkit

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
