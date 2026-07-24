import { describe, expect, it } from 'vitest'
import { searchConformant } from '@refkit/provider-testkit'
import { nailbook } from '../index'

const live = process.env.REFKIT_LIVE === '1'

// Keyless — runs with REFKIT_LIVE=1. One real search + one thumbnail HEAD, no
// multi-page fan-out. Japanese tag words recall best (マグネット = magnetic).
describe.skipIf(!live)('live smoke: nailbook', () => {
  it('returns conformant, HEAD-able references from the real API', { timeout: 30_000 }, async () => {
    const refs = await searchConformant(nailbook(), globalThis.fetch, { query: 'マグネット' })
    expect(refs.length).toBeGreaterThan(0)
    const r = refs[0]
    expect(r.canonicalUrl).toMatch(/^https:\/\/nailbook\.jp\/design\/\d+\/$/)
    expect(r.thumbnail?.url).toBeDefined()
    const head = await fetch(r.thumbnail!.url, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type') ?? '').toMatch(/^image\//)
  })
})
