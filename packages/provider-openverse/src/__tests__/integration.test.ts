import { describe, expect, it } from 'vitest'
import { createRefkit } from '@refkit/core'
import { openverse } from '../index'
import { pexels } from '@refkit/provider-pexels'

const OPENVERSE = { results: [
  { id: 'aaa', title: 'cc0 sky', creator: 'Alice', foreign_landing_url: 'https://ov/aaa', url: 'https://cdn/aaa.jpg', thumbnail: 'https://ov/aaa/thumb', width: 10, height: 10, license: 'cc0', license_version: '1.0', license_url: 'https://cc/cc0' },
  { id: 'bbb', title: 'nc mountain', creator: 'Bob', foreign_landing_url: 'https://ov/bbb', url: 'https://cdn/bbb.jpg', thumbnail: 'https://ov/bbb/thumb', width: 10, height: 10, license: 'by-nc-nd', license_version: '2.0', license_url: 'https://cc/ncnd' },
] }
const PEXELS = { photos: [
  { id: 1, width: 10, height: 10, url: 'https://px/1', photographer: 'Cleo', photographer_url: 'https://px/@cleo', avg_color: '#fff', alt: 'pexels sky', src: { tiny: 'https://px/1/t', medium: 'https://px/1/m', original: 'https://px/1/o' } },
] }

// route the fake fetch to the right fixture by host
const routedFetch = (async (input: Parameters<typeof fetch>[0]) => {
  const u = String(input)
  const body = u.includes('openverse') ? OPENVERSE : PEXELS
  return new Response(JSON.stringify(body), { status: 200 })
}) as typeof fetch

describe('P1 integration: createRefkit + openverse + pexels (offline)', () => {
  it('merges results across both sources', async () => {
    const rk = createRefkit({ providers: [openverse(), pexels({ apiKey: 'k' })], fetch: routedFetch })
    const refs = await rk.search({ query: 'sky', modalities: ['image'] })
    const providers = new Set(refs.map(r => r.source.providerId))
    expect(providers.has('openverse')).toBe(true)
    expect(providers.has('pexels')).toBe(true)
    expect(refs.length).toBe(3) // 2 openverse + 1 pexels
    expect(refs[0].relevance).toBe(1) // RRF top normalized
  })

  it('gateFor commercial-product drops the NC openverse item, keeps cc0 + pexels', async () => {
    const rk = createRefkit({ providers: [openverse(), pexels({ apiKey: 'k' })], fetch: routedFetch })
    const refs = await rk.search({ query: 'sky', modalities: ['image'], gateFor: 'commercial-product' })
    const titles = refs.map(r => r.title)
    expect(titles).toContain('cc0 sky')
    expect(titles).toContain('pexels sky')
    expect(titles).not.toContain('nc mountain') // CC-BY-NC-ND → commercial denied → filtered
  })
})
