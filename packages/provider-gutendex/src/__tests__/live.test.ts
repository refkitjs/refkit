import { liveSmoke } from '@refkit/provider-testkit/live'
import { gutendex } from '../index'

// tolerateUpstreamBlock: gutendex.com's Cloudflare 403s datacenter IPs
// regardless of UA (verified across live-smoke runs 1-3) — treat as
// inconclusive, not as drift.
liveSmoke('gutendex', () => gutendex(), { query: 'love', tolerateUpstreamBlock: true })
