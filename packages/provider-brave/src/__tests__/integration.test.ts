import { describe, expect, it } from 'vitest'
import { createRefkit } from '@refkit/core'
import { brave } from '../index'
import { openverse } from '@refkit/provider-openverse'

const OPENVERSE = { results: [
  { id: 'aaa', title: 'cc0 sky', creator: 'Alice', foreign_landing_url: 'https://ov/aaa', url: 'https://cdn/aaa.jpg', thumbnail: 'https://ov/aaa/thumb', width: 10, height: 10, license: 'cc0', license_version: '1.0', license_url: 'https://cc/cc0' },
] }
const BRAVE = { results: [
  { type: 'image_result', title: 'web sky', url: 'https://example.com/sky', source: 'example.com', thumbnail: { src: 'https://imgs.search.brave.com/x.jpg' }, properties: { url: 'https://cdn.example.com/sky.jpg' } },
] }

const routedFetch = (async (input: Parameters<typeof fetch>[0]) => {
  const u = String(input)
  const body = u.includes('brave') ? BRAVE : OPENVERSE
  return new Response(JSON.stringify(body), { status: 200 })
}) as typeof fetch

describe('clean + discovery integration (offline)', () => {
  it('merges clean (openverse) and discovery (brave) results', async () => {
    const rk = createRefkit({ providers: [openverse(), brave({ token: 'k' })], fetch: routedFetch })
    const refs = await rk.search({ query: 'sky', modalities: ['image'] })
    const providers = new Set(refs.map(r => r.source.providerId))
    expect(providers.has('openverse')).toBe(true)
    expect(providers.has('brave')).toBe(true)
  })

  it('gateFor commercial-product keeps the clean cc0 result, drops the discovery (needs-review) one', async () => {
    const rk = createRefkit({ providers: [openverse(), brave({ token: 'k' })], fetch: routedFetch })
    const refs = await rk.search({ query: 'sky', modalities: ['image'], gateFor: 'commercial-product' })
    const titles = refs.map(r => r.title)
    expect(titles).toContain('cc0 sky')   // CC0 → allowed
    expect(titles).not.toContain('web sky') // unknown → needs-review → filtered by the gate
  })
})
