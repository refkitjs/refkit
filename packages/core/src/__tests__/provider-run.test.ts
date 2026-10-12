import { describe, expect, it, vi } from 'vitest'
import { providerCacheKey, runProviderSearch, stableStringify } from '../provider-run'
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
    expect(a).toMatch(/^refkit:v4:p:[a-z0-9]+$/) // no spaces/quotes → safe for strict KV backends
    expect(a.length).toBeLessThan(64)
  })

  it('is insensitive to object key order', () => {
    const a = providerCacheKey('p', { text: 'x', modalities: ['image'], providerOptions: { a: 1, b: 2 } })
    const b = providerCacheKey('p', { modalities: ['image'], providerOptions: { b: 2, a: 1 }, text: 'x' })
    expect(a).toBe(b)
  })

  it('is version 4: an entry cached in the pre-union shape (v3) is missed, not parsed', async () => {
    const q = { text: 'q', modalities: ['image' as const] }
    const key = providerCacheKey('p', q)
    expect(key.startsWith('refkit:v4:p:')).toBe(true)
    const cache = memoryCache()
    const old = { id: 'p:old', modality: 'image', source: { providerId: 'p', sourceUrl: 'https://x.test/old' }, canonicalUrl: 'https://x.test/old', rights: ref('https://x.test/old').rights, verifiedAt: '2026-01-01T00:00:00.000Z', relevance: 0 }
    cache.store.set(key.replace(/^refkit:v4:/, 'refkit:v3:'), JSON.stringify({ q: stableStringify(q), refs: [old] }))
    const run = await runProviderSearch(provider([ref('https://x.test/live')]), q, { fetch: (async () => new Response('')) as typeof fetch, cache, cacheTtlMs: 60_000, cacheRaw: true })
    expect(run.ok && run.cached).toBeUndefined()
    expect(run.ok && run.valid.map(r => r.canonicalUrl)).toEqual(['https://x.test/live'])
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

describe('runProviderSearch modality boundary', () => {
  // Declares image only, so whatever the caller asked for, its share of the
  // query (query.modalities) is ['image']: a video item is a modality leak.
  const leaky = defineProvider({
    id: 'p', modalities: ['image'],
    search: async () => [
      ref('https://x.test/1'),
      { modality: 'video', sourceUrl: 'https://x.test/2', rights: ref('https://x.test/2').rights },
    ],
  })
  const fetchStub = (async () => new Response('')) as typeof fetch

  it('counts an item outside query.modalities as rejected and reports it, like a malformed item', async () => {
    const onError = vi.fn()
    const run = await runProviderSearch(leaky, { text: 'q', modalities: ['image'] }, { fetch: fetchStub, cacheTtlMs: 0, cacheRaw: true, onError })
    expect(run.ok && run.valid.map(r => r.canonicalUrl)).toEqual(['https://x.test/1'])
    expect(run.ok && run.returned).toBe(2)
    expect(run.ok && run.rejected).toBe(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/modality "video".*\[image\]/)
  })

  it('never caches the rejected item', async () => {
    const cache = memoryCache()
    await runProviderSearch(leaky, { text: 'q', modalities: ['image'] }, { fetch: fetchStub, cache, cacheTtlMs: 60_000, cacheRaw: true })
    await new Promise(r => setTimeout(r)) // cache write is fire-and-forget
    const [payload] = [...cache.store.values()]
    expect(JSON.parse(payload).refs.map((r: { modality: string }) => r.modality)).toEqual(['image'])
  })
})
