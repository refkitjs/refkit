import { describe, expect, it } from 'vitest'
import { providerCacheKey, runProviderSearch } from '../provider-run'
import type { KeyValueCache, ReferenceProvider } from '../provider'
import type { Reference } from '../reference'

const ref = (url: string): Reference => ({
  id: `p:${url}`,
  modality: 'image',
  source: { providerId: 'p', sourceUrl: url },
  canonicalUrl: url,
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
  verifiedAt: '2026-06-22T00:00:00.000Z',
  relevance: 0,
  raw: { upstream: 'payload' },
})

const provider = (results: Reference[]): ReferenceProvider => ({
  id: 'p',
  modalities: ['image'],
  search: async () => results,
})

function memoryCache(): KeyValueCache & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    get: async (k) => store.get(k),
    set: async (k, v) => { store.set(k, v) },
  }
}

describe('providerCacheKey', () => {
  it('embeds the full normalized query — distinct queries can never collide', () => {
    const a = providerCacheKey('p', { text: 'lion', modalities: ['image'] })
    const b = providerCacheKey('p', { text: 'tiger', modalities: ['image'] })
    expect(a).not.toBe(b)
    expect(a).toContain('lion')
  })

  it('is insensitive to object key order', () => {
    const a = providerCacheKey('p', { text: 'x', modalities: ['image'], providerOptions: { a: 1, b: 2 } })
    const b = providerCacheKey('p', { modalities: ['image'], providerOptions: { b: 2, a: 1 }, text: 'x' })
    expect(a).toBe(b)
  })
})

describe('runProviderSearch cacheRaw', () => {
  const deps = { fetch: (() => { throw new Error('unused') }) as unknown as typeof fetch, cacheTtlMs: 60_000 }

  it('cacheRaw: true (default behavior) keeps raw in the cached payload', async () => {
    const cache = memoryCache()
    await runProviderSearch(provider([ref('https://a/1')]), { text: 'q', modalities: ['image'] }, { ...deps, cache, cacheRaw: true })
    await new Promise(r => setTimeout(r)) // cache write is fire-and-forget
    const [payload] = [...cache.store.values()]
    expect(JSON.parse(payload)[0].raw).toEqual({ upstream: 'payload' })
  })

  it('cacheRaw: false strips raw from the cached payload but not from live results', async () => {
    const cache = memoryCache()
    const run = await runProviderSearch(provider([ref('https://a/1')]), { text: 'q', modalities: ['image'] }, { ...deps, cache, cacheRaw: false })
    expect(run.ok && run.valid[0].raw).toEqual({ upstream: 'payload' })
    await new Promise(r => setTimeout(r))
    const [payload] = [...cache.store.values()]
    expect(JSON.parse(payload)[0].raw).toBeUndefined()
  })
})
