import { describe, expect, it, vi } from 'vitest'
import { createRefkit } from '../client'
import { defineProvider } from '../provider'
import { lexicalReranker } from '../rerank'
import type { Reference } from '../reference'
import type { LicenseId } from '../license'

const ref = (id: string, url: string, license: LicenseId = 'CC0-1.0'): Reference => ({
  id,
  modality: 'image',
  source: { providerId: id.split('-')[0], sourceUrl: url },
  canonicalUrl: url,
  rights: { license, rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
  verifiedAt: '2026-06-22T00:00:00.000Z',
  relevance: 0,
})

const provider = (id: string, refs: Reference[]) =>
  defineProvider({ id, modalities: ['image'], queryFeatures: ['keyword'], search: async () => refs })

const failing = (id: string) =>
  defineProvider({ id, modalities: ['image'], queryFeatures: ['keyword'], search: async () => { throw new Error('boom') } })

describe('createRefkit', () => {
  it('throws when no providers are given', () => {
    expect(() => createRefkit({ providers: [] })).toThrow()
  })

  it('merges results across providers and normalizes relevance', async () => {
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), provider('b', [ref('b-1', 'https://b/1')])] })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(2)
    expect(out[0].relevance).toBeGreaterThan(0)
  })

  it('degrades gracefully when one provider fails (onProviderError, survivors merged)', async () => {
    const onProviderError = vi.fn()
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), failing('b')] })
    const out = await rk.search({ query: 'x', modalities: ['image'], onProviderError })
    expect(out).toHaveLength(1)
    expect(onProviderError).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'b' }))
  })

  it('throws AggregateError only when ALL providers fail', async () => {
    const rk = createRefkit({ providers: [failing('a'), failing('b')] })
    await expect(rk.search({ query: 'x', modalities: ['image'] })).rejects.toBeInstanceOf(AggregateError)
  })

  it('gateFor drops non-allowed results', async () => {
    const rk = createRefkit({
      providers: [provider('a', [ref('a-1', 'https://a/1', 'CC0-1.0'), ref('a-2', 'https://a/2', 'proprietary')])],
    })
    const out = await rk.search({ query: 'x', modalities: ['image'], gateFor: 'commercial-product' })
    expect(out.map(r => r.canonicalUrl)).toEqual(['https://a/1'])
  })

  it('applies the rerank hook post-merge with { query, refs, signal }', async () => {
    const ac = new AbortController()
    let seenQuery = ''
    let seenSignal: AbortSignal | undefined
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1'), ref('a-2', 'https://a/2')])] })
    const out = await rk.search({
      query: 'x',
      modalities: ['image'],
      signal: ac.signal,
      rerank: ({ query, refs, signal }) => { seenQuery = query; seenSignal = signal; return [...refs].reverse() },
    })
    expect(seenQuery).toBe('x')
    expect(seenSignal).toBe(ac.signal)
    expect(out[0].canonicalUrl).toBe('https://a/2')
  })

  it('evaluateUse / buildAttribution methods operate on a Reference', () => {
    const rk = createRefkit({ providers: [provider('a', [])] })
    const r = ref('a-1', 'https://a/1', 'CC-BY')
    expect(rk.evaluateUse(r, 'commercial-product').decision).toBe('allowed-with-attribution')
    expect(rk.buildAttribution(r).required).toBe(true)
  })

  it('cursor: pages via controls.page, dedupes across pages, and chains nextCursor', async () => {
    // A paging provider whose page 2 overlaps page 1 — the RRF reality.
    const pages: Record<number, Reference[]> = {
      1: [ref('a-1', 'https://a/1'), ref('a-2', 'https://a/2')],
      2: [ref('a-2', 'https://a/2'), ref('a-3', 'https://a/3')],
    }
    const seenPages: Array<number | undefined> = []
    const paging = defineProvider({
      id: 'a',
      modalities: ['image'],
      capabilities: { controls: ['page'] },
      search: async (q) => {
        seenPages.push(q.controls?.page)
        return pages[q.controls?.page ?? 1] ?? []
      },
    })
    const rk = createRefkit({ providers: [paging] })

    const page1 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2 })
    expect(page1.references.map(r => r.canonicalUrl)).toEqual(['https://a/1', 'https://a/2'])
    expect(page1.meta.nextCursor).toBeDefined()

    const page2 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, cursor: page1.meta.nextCursor })
    expect(seenPages).toEqual([undefined, 2]) // cursor routed page 2 to the provider
    expect(page2.references.map(r => r.canonicalUrl)).toEqual(['https://a/3']) // overlap deduped

    const page3 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, cursor: page2.meta.nextCursor })
    expect(page3.references).toEqual([]) // exhausted
    expect(page3.meta.nextCursor).toBeUndefined() // empty page ends the chain
  })

  it('cursor: rejects strings that did not come from meta.nextCursor', async () => {
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')])] })
    await expect(rk.search({ query: 'x', modalities: ['image'], cursor: 'not-a-cursor' })).rejects.toThrow(/invalid cursor/)
    await expect(rk.search({ query: 'x', modalities: ['image'], cursor: '{"v":9}' })).rejects.toThrow(/invalid cursor/)
  })

  it('surfaces cross-source license conflicts as meta.warnings with conservative rights', async () => {
    const rk = createRefkit({
      providers: [
        provider('a', [ref('a-1', 'https://shared/1', 'CC-BY')]),
        provider('b', [ref('b-1', 'https://shared/1', 'CC-BY-NC')]),
      ],
    })
    const { references, meta } = await rk.searchWithMeta({ query: 'x', modalities: ['image'] })
    expect(references).toHaveLength(1)
    expect(references[0].rights.license).toBe('CC-BY-NC')
    expect(meta.warnings.some(w => w.includes('cross-source license conflict'))).toBe(true)
  })

  it('queries only providers matching the modality', async () => {
    const textOnly = defineProvider({
      id: 't', modalities: ['text'], queryFeatures: [],
      search: async () => { throw new Error('should not be called for an image search') },
    })
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), textOnly] })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(1)
  })

  it('defaults fetch to globalThis.fetch when options.fetch is omitted', async () => {
    // resilience defaults ON (H8), so ctx.fetch is a retrying wrapper rather than
    // globalThis.fetch itself — assert on the underlying implementation it delegates to.
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    let capturedFetch: typeof fetch | undefined
    const capturingProvider = defineProvider({
      id: 'cap',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async (_q, ctx) => { capturedFetch = ctx.fetch; await ctx.fetch('https://cap/x'); return [] },
    })
    const rk = createRefkit({ providers: [capturingProvider] })
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(capturedFetch).not.toBe(globalThis.fetch) // wrapped by retryingFetch
    expect(globalFetchSpy.mock.calls[0]?.[0]).toBe('https://cap/x')
    globalFetchSpy.mockRestore()
  })

  it('resolves globalThis.fetch at search time, not at createRefkit time (late-binding)', async () => {
    // createRefkit is called BEFORE globalThis.fetch is replaced — a client that
    // resolved options.fetch ?? globalThis.fetch once at creation time would be
    // stuck delegating to the pre-replacement implementation forever.
    let capturedFetch: typeof fetch | undefined
    const capturingProvider = defineProvider({
      id: 'cap',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async (_q, ctx) => { capturedFetch = ctx.fetch; await ctx.fetch('https://cap/late'); return [] },
    })
    const rk = createRefkit({ providers: [capturingProvider] })
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(capturedFetch).not.toBe(globalThis.fetch) // still wrapped by retryingFetch
    expect(globalFetchSpy.mock.calls[0]?.[0]).toBe('https://cap/late') // delegated to the NEW globalThis.fetch
    globalFetchSpy.mockRestore()
  })

  it('throws a clear Error (not AggregateError) when no provider supports the requested modality', async () => {
    const imageOnly = provider('img', [ref('img-1', 'https://img/1')])
    const rk = createRefkit({ providers: [imageOnly] })
    await expect(rk.search({ query: 'x', modalities: ['video'] })).rejects.toThrow(
      "refkit.search: no registered provider supports modalities [video]"
    )
    await expect(rk.search({ query: 'x', modalities: ['video'] })).rejects.not.toBeInstanceOf(AggregateError)
  })

  it('provider fulfills but returns malformed data: onProviderError called, result excluded, no throw', async () => {
    const onProviderError = vi.fn()
    const malformedProvider = defineProvider({
      id: 'bad',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async () => [{ id: '', modality: 'image' } as unknown as Reference],
    })
    const goodProvider = provider('good', [ref('good-1', 'https://good/1')])
    const rk = createRefkit({ providers: [malformedProvider, goodProvider] })
    const out = await rk.search({ query: 'x', modalities: ['image'], onProviderError })
    expect(onProviderError).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'bad' }))
    expect(out.every(r => r.id !== '')).toBe(true)
    expect(out).toHaveLength(1)
  })

  it('search() applies lexicalReranker end-to-end, ordering by query relevance', async () => {
    const meadow = { ...ref('a-1', 'https://a/1'), title: 'a quiet meadow' }
    const city = { ...ref('a-2', 'https://a/2'), title: 'cyberpunk neon city' }
    const rk = createRefkit({ providers: [provider('a', [meadow, city])] })
    const out = await rk.search({ query: 'cyberpunk neon', modalities: ['image'], rerank: lexicalReranker() })
    expect(out[0].canonicalUrl).toBe('https://a/2')
  })

  const capturing = (sink: { limit?: number }, count: number) =>
    defineProvider({
      id: 'cap',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async (q) => {
        sink.limit = q.limit
        return Array.from({ length: count }, (_, i) => ref(`cap-${i}`, `https://cap/${i}`))
      },
    })

  it('overfetches a wider pool per provider (limit × poolFactor), then narrows to limit', async () => {
    const sink: { limit?: number } = {}
    const rk = createRefkit({ providers: [capturing(sink, 50)] })
    const out = await rk.search({ query: 'x', modalities: ['image'], limit: 5 })
    expect(sink.limit).toBe(20) // 5 × default poolFactor (4)
    expect(out).toHaveLength(5) // narrowed back to limit
  })

  it('respects an explicit poolFactor and clamps it to >= 1', async () => {
    const sink: { limit?: number } = {}
    const rk = createRefkit({ providers: [capturing(sink, 0)] })
    await rk.search({ query: 'x', modalities: ['image'], limit: 10, poolFactor: 2 })
    expect(sink.limit).toBe(20)
    await rk.search({ query: 'x', modalities: ['image'], limit: 10, poolFactor: 0 })
    expect(sink.limit).toBe(10) // clamped to 1 → no overfetch below limit
    await rk.search({ query: 'x', modalities: ['image'], limit: 10, poolFactor: NaN })
    expect(sink.limit).toBe(40) // non-finite → falls back to the default factor (4)
  })

  it('caps per-provider fetch at MAX_POOL_LIMIT, but never below an explicit limit', async () => {
    const sink: { limit?: number } = {}
    const rk = createRefkit({ providers: [capturing(sink, 0)] })
    await rk.search({ query: 'x', modalities: ['image'], limit: 30 }) // 30×4=120 → capped to 100
    expect(sink.limit).toBe(100)
    await rk.search({ query: 'x', modalities: ['image'], limit: 150 }) // > cap → fetch the limit itself, not less
    expect(sink.limit).toBe(150)
  })

  it('forwards provider-specific search options only to the matching provider', async () => {
    let seenA: unknown
    let seenB: unknown
    const a = defineProvider({
      id: 'a',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async (q) => { seenA = q.providerOptions; return [] },
    })
    const b = defineProvider({
      id: 'b',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async (q) => { seenB = q.providerOptions; return [] },
    })
    const rk = createRefkit({ providers: [a, b] })
    await rk.search({
      query: 'x',
      modalities: ['image'],
      providerOptions: { a: { orderBy: 'latest' }, b: { sort: 'relevance' } },
    })
    expect(seenA).toEqual({ orderBy: 'latest' })
    expect(seenB).toEqual({ sort: 'relevance' })
  })

  it('searchWithMeta returns provider status, warnings, and gate summary', async () => {
    const textOnly = defineProvider({
      id: 'text',
      modalities: ['text'],
      queryFeatures: ['keyword'],
      search: async () => [],
    })
    const rk = createRefkit({
      providers: [
        provider('ok', [ref('ok-1', 'https://ok/1', 'CC0-1.0'), ref('ok-2', 'https://ok/2', 'proprietary')]),
        failing('bad'),
        textOnly,
      ],
    })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], gateFor: 'commercial-product' })

    expect(out.references.map(r => r.canonicalUrl)).toEqual(['https://ok/1'])
    expect(out.meta.providers).toEqual([
      { providerId: 'ok', status: 'fulfilled', returned: 2, accepted: 2, rejected: 0, latencyMs: expect.any(Number) },
      { providerId: 'bad', status: 'failed', error: 'boom', latencyMs: expect.any(Number) },
      { providerId: 'text', status: 'skipped', reason: 'unsupported-modality' },
    ])
    expect(out.meta.gate).toEqual({ intent: 'commercial-product', before: 2, after: 1, dropped: 1 })
    expect(out.meta.warnings).toContain('1 provider(s) failed; returning partial results.')
  })

  it('uses merge.isDuplicate to dedupe host-supplied fingerprints during search', async () => {
    const a = { ...ref('a-1', 'https://a/1'), relevance: 0.2, raw: { fingerprint: 'same' } }
    const b = { ...ref('a-2', 'https://a/2'), relevance: 0.9, raw: { fingerprint: 'same' } }
    const rk = createRefkit({
      providers: [provider('a', [b, a])],
      merge: {
        isDuplicate: (candidate, existing) =>
          (candidate.raw as { fingerprint?: string }).fingerprint === (existing.raw as { fingerprint?: string }).fingerprint,
      },
    })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out.map(r => r.id)).toEqual(['a-2'])
  })

  it('searchWithMeta reports applied and ignored unified controls by provider', async () => {
    const controlled = defineProvider({
      id: 'controlled',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      capabilities: { controls: ['orientation', 'color'] },
      search: async () => [ref('controlled-1', 'https://controlled/1')],
    })
    const plain = defineProvider({
      id: 'plain',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      capabilities: { controls: [] },
      search: async () => [ref('plain-1', 'https://plain/1')],
    })
    const rk = createRefkit({ providers: [controlled, plain] })
    const out = await rk.searchWithMeta({
      query: 'x',
      modalities: ['image'],
      controls: { orientation: 'landscape', color: 'blue', safety: 'strict' },
    })
    expect(out.meta.controls).toEqual({
      requested: ['orientation', 'color', 'safety'],
      appliedByProvider: { controlled: ['orientation', 'color'], plain: [] },
      ignoredByProvider: { controlled: ['safety'], plain: ['orientation', 'color', 'safety'] },
    })
  })

  it('times out a hanging provider, returns partial results, and reports the timeout', async () => {
    vi.useFakeTimers()
    try {
      const hanging = defineProvider({
        id: 'hang', modalities: ['image'], queryFeatures: ['keyword'],
        search: () => new Promise(() => {}), // never settles, ignores ctx.signal
      })
      const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), hanging] })
      const p = rk.searchWithMeta({ query: 'x', modalities: ['image'] })
      await vi.advanceTimersByTimeAsync(10_000)
      const out = await p
      expect(out.references).toHaveLength(1)
      const hangStatus = out.meta.providers.find(s => s.providerId === 'hang')
      expect(hangStatus?.status).toBe('failed')
      expect(hangStatus?.error).toContain('timeout after 10000ms')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a well-behaved provider that rejects on ctx.signal abort observes the timeout and is reported failed', async () => {
    vi.useFakeTimers()
    try {
      let observedAbort = false
      const wellBehaved = defineProvider({
        id: 'wb', modalities: ['image'], queryFeatures: ['keyword'],
        search: (_q, ctx) => new Promise<Reference[]>((_resolve, reject) => {
          ctx.signal?.addEventListener('abort', () => {
            observedAbort = true
            reject(ctx.signal?.reason ?? new Error('aborted'))
          })
        }),
      })
      const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), wellBehaved] })
      const p = rk.searchWithMeta({ query: 'x', modalities: ['image'] })
      await vi.advanceTimersByTimeAsync(10_000)
      const out = await p
      expect(observedAbort).toBe(true)
      const wbStatus = out.meta.providers.find(s => s.providerId === 'wb')
      expect(wbStatus?.status).toBe('failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resilience: false disables the timeout entirely', async () => {
    vi.useFakeTimers()
    try {
      let done = false
      const slow = defineProvider({
        id: 'slow', modalities: ['image'], queryFeatures: ['keyword'],
        search: () => new Promise(resolve => setTimeout(() => { done = true; resolve([ref('slow-1', 'https://s/1')]) }, 60_000)),
      })
      const rk = createRefkit({ providers: [slow], resilience: false })
      const p = rk.search({ query: 'x', modalities: ['image'] })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await p).toHaveLength(1)
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a user abort of input.signal fast-fails a provider that ignores ctx.signal, instead of waiting for the deadline', async () => {
    vi.useFakeTimers()
    try {
      const ac = new AbortController()
      const ignoresSignal = defineProvider({
        id: 'ignorer', modalities: ['image'], queryFeatures: ['keyword'],
        search: () => new Promise(() => {}), // never settles, never looks at ctx.signal
      })
      const rk = createRefkit({ providers: [ignoresSignal] })
      const p = rk.search({ query: 'x', modalities: ['image'], signal: ac.signal }).catch(e => e)
      ac.abort(new Error('user cancelled'))
      // advance only a small amount — far less than the 10s default deadline —
      // the search must already have settled from the parent abort, not the timer
      await vi.advanceTimersByTimeAsync(50)
      const result = await p
      expect(result).toBeInstanceOf(AggregateError) // all providers failed → AggregateError
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives providers a retrying ctx.fetch: a 500-then-200 upstream succeeds transparently', async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const usesFetch = defineProvider({
      id: 'net', modalities: ['image'], queryFeatures: ['keyword'],
      search: async (_q, ctx) => {
        const res = await ctx.fetch('https://net/api', { signal: ctx.signal })
        if (!res.ok) throw new Error(`net failed: ${res.status}`)
        return [ref('net-1', 'https://net/1')]
      },
    })
    const rk = createRefkit({ providers: [usesFetch], fetch: upstream as unknown as typeof fetch, resilience: { retries: 1, timeoutMs: 10_000 } })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(1)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('reports latencyMs on fulfilled and failed providers, not on skipped', async () => {
    const textOnly = defineProvider({ id: 'text', modalities: ['text'], queryFeatures: [], search: async () => [] })
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), failing('bad'), textOnly] })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'] })
    const byId = Object.fromEntries(out.meta.providers.map(s => [s.providerId, s]))
    expect(byId.a.latencyMs).toEqual(expect.any(Number))
    expect(byId.bad.latencyMs).toEqual(expect.any(Number))
    expect(byId.text.latencyMs).toBeUndefined()
  })

  const mapCache = () => {
    const m = new Map<string, string>()
    return {
      store: m,
      ttls: [] as (number | undefined)[],
      async get(k: string) { return m.get(k) },
      async set(k: string, v: string, ttlMs?: number) { m.set(k, v); this.ttls.push(ttlMs) },
    }
  }

  it('serves a repeat query from the cache without re-hitting the provider', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'] })
    expect(calls).toBe(1)
    expect(out.references).toHaveLength(1)
    expect(out.meta.providers[0]).toMatchObject({ status: 'fulfilled', cached: true })
    expect(cache.ttls).toEqual([300_000]) // default cacheTtlMs, one set for the first (live) search
  })

  it('different queries use different cache keys', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] })
    await rk.search({ query: 'y', modalities: ['image'] })
    expect(calls).toBe(2)
  })

  it('a corrupt or invalid cache entry falls back to a live fetch', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] })
    for (const k of cache.store.keys()) cache.store.set(k, '{not json')
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(calls).toBe(2)
  })

  it('cache errors are non-fatal: a throwing cache degrades to live search', async () => {
    const broken = {
      async get(): Promise<string | undefined> { throw new Error('cache down') },
      async set(): Promise<void> { throw new Error('cache down') },
    }
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')])], cache: broken })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(1)
  })

  it('honors a custom cacheTtlMs', async () => {
    const cache = mapCache()
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')])], cache, cacheTtlMs: 1234 })
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(cache.ttls).toEqual([1234])
  })

  it('a cache hit still flows through the license gate (hits are pre-merge; the gate stays live)', async () => {
    const cache = mapCache()
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1', 'proprietary')])], cache })
    await rk.search({ query: 'x', modalities: ['image'] })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], gateFor: 'commercial-product' })
    expect(out.meta.providers[0]).toMatchObject({ status: 'fulfilled', cached: true })
    expect(out.references).toHaveLength(0)
    expect(out.meta.gate).toMatchObject({ intent: 'commercial-product', before: 1, after: 0, dropped: 1 })
  })

  it('a never-resolving cache.get does not hang the search — deadline-bounded cache read falls back to live results', async () => {
    vi.useFakeTimers()
    try {
      const hangingCache = {
        get: () => new Promise<string | undefined>(() => {}), // never resolves
        set: async () => {},
      }
      const rk = createRefkit({
        providers: [provider('a', [ref('a-1', 'https://a/1')])],
        cache: hangingCache,
        resilience: { timeoutMs: 100 },
      })
      const p = rk.search({ query: 'x', modalities: ['image'] })
      await vi.advanceTimersByTimeAsync(100)
      const out = await p
      expect(out).toHaveLength(1) // live results, not a hang
    } finally {
      vi.useRealTimers()
    }
  })

  it('providerOptions key order does not change the cache key', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'], providerOptions: { c: { b: 2, a: 1 } } })
    await rk.search({ query: 'x', modalities: ['image'], providerOptions: { c: { a: 1, b: 2 } } })
    expect(calls).toBe(1) // second search is a cache hit despite the different key order
  })

  it('a cache hit cancels its timeout handle — no leaked timers/listeners across repeated hits', async () => {
    vi.useFakeTimers()
    try {
      const cache = mapCache()
      const counted = defineProvider({
        id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
        search: async () => [ref('c-1', 'https://c/1')],
      })
      const rk = createRefkit({ providers: [counted], cache })
      await rk.search({ query: 'x', modalities: ['image'] }) // live search, populates cache
      expect(vi.getTimerCount()).toBe(0)
      for (let i = 0; i < 5; i++) {
        await rk.search({ query: 'x', modalities: ['image'] }) // cache hit
        expect(vi.getTimerCount()).toBe(0) // timeout handle must be cancelled on every exit path
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cache entry with one malformed item validates per-item (matches the live path): good kept, bad reported+rejected', async () => {
    const cache = mapCache()
    const onProviderError = vi.fn()
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => [ref('c-1', 'https://c/1')],
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] }) // live search, populates cache
    // seed the cache entry with 1 valid + 1 malformed item
    for (const k of cache.store.keys()) {
      const valid = JSON.parse(cache.store.get(k)!)
      cache.store.set(k, JSON.stringify([...valid, { id: '', modality: 'image' }]))
    }
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], onProviderError })
    expect(out.references.map(r => r.id)).toEqual(['c-1'])
    expect(out.meta.providers[0]).toMatchObject({ cached: true, returned: 2, accepted: 1, rejected: 1 })
    expect(onProviderError).toHaveBeenCalledTimes(1)
    expect(onProviderError).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'c' }))
  })

  it('stableStringify cache keys treat undefined-valued keys the same as absent keys', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'], providerOptions: { c: { a: 1, b: undefined } } })
    await rk.search({ query: 'x', modalities: ['image'], providerOptions: { c: { a: 1 } } })
    expect(calls).toBe(1) // second search hits the same cache entry as the first
  })
})
