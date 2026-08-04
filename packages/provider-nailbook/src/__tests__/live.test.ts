import { describe, expect, it } from 'vitest'
import { searchConformant } from '@refkit/provider-testkit'
import { nailbook } from '../index'

const live = process.env.REFKIT_LIVE === '1'

// Keyless — runs with REFKIT_LIVE=1. One real search + one thumbnail HEAD, no
// multi-page fan-out. Japanese tag words recall best (マグネット = magnetic).
describe.skipIf(!live)('live smoke: nailbook', () => {
  it('returns conformant, HEAD-able references from the real API', { timeout: 30_000 }, async (t) => {
    // nailbook.jp's edge 403s datacenter IPs (e.g. Actions runners) — same
    // situation as gutendex/Cloudflare. A WAF 403 says nothing about API
    // drift, so treat it as inconclusive and skip, mirroring liveSmoke's
    // tolerateUpstreamBlock. Only 403 is tolerated; anything else still fails.
    const wafSkip = (detail: string): void => {
      console.warn(`[live-smoke] nailbook: upstream WAF returned 403 from this runner — inconclusive for drift, skipping. (${detail})`)
      t.skip()
    }
    let refs
    try {
      refs = await searchConformant(nailbook(), globalThis.fetch, { query: 'マグネット' })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/\b403\b/.test(message)) return wafSkip(message)
      throw e
    }
    expect(refs.length).toBeGreaterThan(0)
    const r = refs[0]
    expect(r.canonicalUrl).toMatch(/^https:\/\/nailbook\.jp\/design\/\d+\/$/)
    expect(r.thumbnail?.url).toBeDefined()
    const head = await fetch(r.thumbnail!.url, { method: 'HEAD' })
    if (head.status === 403) return wafSkip('thumbnail HEAD 403')
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type') ?? '').toMatch(/^image\//)
  })
})
