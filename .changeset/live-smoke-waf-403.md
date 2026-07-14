---
"@refkit/provider-testkit": patch
"@refkit/provider-gutendex": patch
---

Stop the weekly live-smoke from crying wolf on WAF blocks: `liveSmoke` gains an
opt-in `tolerateUpstreamBlock` that skips (with a warning) when the source's WAF
returns HTTP 403 from the runner's datacenter IP — 404s, 5xx, schema changes,
and empty results still fail. Applied to gutendex only, whose Cloudflare front
blocks GitHub Actions IPs regardless of User-Agent (verified with both a
descriptive bot UA and a browser UA). gutendex requests also send an explicit
`Accept: application/json` now.
