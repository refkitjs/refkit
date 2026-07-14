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

gutendex additionally gains a `baseUrl` config: the upstream docs frame
gutendex.com as a test instance ("You should run your own server, but you can
test queries at gutendex.com"), so production/datacenter consumers can now
point the provider at a self-hosted Gutendex.
