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
})
