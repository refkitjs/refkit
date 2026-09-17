import { describe, expect, it } from 'vitest'
import { providerCacheKey, runProviderSearch } from '../provider-run'
import { defineProvider, type KeyValueCache, type ReferenceProvider } from '../provider'
import type { EmittedReference } from '../reference'

const ref = (url: string): EmittedReference => ({
  modality: 'image',
  sourceUrl: url,
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
  raw: { upstream: 'payload' },
})

const provider = (results: EmittedReference[]): ReferenceProvider => ({
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
  it('is short, fixed-shape, and free of raw query characters', () => {
    const a = providerCacheKey('p', { text: 'lion cub  "quoted" \n spaced', modalities: ['image'] })
    const b = providerCacheKey('p', { text: 'tiger', modalities: ['image'] })
    expect(a).not.toBe(b)
    expect(a).toMatch(/^refkit:v3:p:[a-z0-9]+$/) // no spaces/quotes → safe for strict KV backends
    expect(a.length).toBeLessThan(64)
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
    expect(JSON.parse(payload).refs[0].raw).toEqual({ upstream: 'payload' })
  })

  it('cacheRaw: false strips raw from the cached payload but not from live results', async () => {
    const cache = memoryCache()
    const run = await runProviderSearch(provider([ref('https://a/1')]), { text: 'q', modalities: ['image'] }, { ...deps, cache, cacheRaw: false })
    expect(run.ok && run.valid[0].raw).toEqual({ upstream: 'payload' })
    await new Promise(r => setTimeout(r))
    const [payload] = [...cache.store.values()]
    expect(JSON.parse(payload).refs[0].raw).toBeUndefined()
  })
})

describe('runProviderSearch completion', () => {
  it('completes emitted items and truncates to query.limit', async () => {
    const provider = defineProvider({
      id: 'p', modalities: ['image'],
      search: async () => Array.from({ length: 5 }, (_, i) => ({
        modality: 'image' as const, sourceUrl: `https://x.test/${i}`,
        rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed' as const, raw: { sourceTerms: 't', sourceUrl: 'u' } },
      })),
    })
    const run = await runProviderSearch(provider, { text: 'q', modalities: ['image'], limit: 3 }, { fetch: (async () => new Response('')) as typeof fetch, cacheTtlMs: 0, cacheRaw: true })
    expect(run.ok && run.valid.length).toBe(3)
    expect(run.ok && run.returned).toBe(5)
    expect(run.ok && run.valid[0].source.providerId).toBe('p')
    expect(run.ok && run.valid[0].id.startsWith('p:')).toBe(true)
  })
})
