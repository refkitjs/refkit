import { describe, expect, it, vi } from 'vitest'
import { createRefkit } from '../client'
import { searchMetaSchema } from '../schemas'
import { cursorSeenKey, decodeCursor } from '../cursor'
import { defineProvider, type ReferenceProvider } from '../provider'
import { lexicalReranker } from '../rerank'
import { completeReference, type EmittedReference } from '../reference'
import type { LicenseId } from '../license'

const ref = (url: string, license: LicenseId = 'CC0-1.0'): EmittedReference => ({
  modality: 'image',
  sourceUrl: url,
  rights: { license, rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
})

const provider = (id: string, refs: EmittedReference[]) =>
  defineProvider({ id, modalities: ['image'], search: async () => refs })

const failing = (id: string) =>
  defineProvider({ id, modalities: ['image'], search: async () => { throw new Error('boom') } })

describe('createRefkit', () => {
  it('throws when no providers are given', () => {
    expect(() => createRefkit({ providers: [] })).toThrow()
  })

  it('merges results across providers and normalizes relevance', async () => {
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), provider('b', [ref('https://b/1')])] })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(2)
    expect(out[0].relevance).toBeGreaterThan(0)
  })

  it('degrades gracefully when one provider fails (onProviderError, survivors merged)', async () => {
    const onProviderError = vi.fn()
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), failing('b')] })
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
      providers: [provider('a', [ref('https://a/1', 'CC0-1.0'), ref('https://a/2', 'proprietary')])],
    })
    const out = await rk.search({ query: 'x', modalities: ['image'], gateFor: 'commercial-product' })
    expect(out.map(r => r.canonicalUrl)).toEqual(['https://a/1'])
  })

  it('applies the rerank hook post-merge with { query, refs, signal }', async () => {
    const ac = new AbortController()
    let seenQuery = ''
    let seenSignal: AbortSignal | undefined
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1'), ref('https://a/2')])] })
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
    const r = completeReference('a', ref('https://a/1', 'CC-BY'), '2026-06-22T00:00:00.000Z')
    expect(rk.evaluateUse(r, 'commercial-product').decision).toBe('allowed-with-attribution')
    expect(rk.buildAttribution(r).required).toBe(true)
  })

  it('cursor: drains the overfetched pool before advancing the provider page', async () => {
    // fetchLimit > limit: the page-1 pool holds MORE than one batch. The cursor
    // must keep returning from the same provider page until it is exhausted —
    // advancing per batch would skip ranked results forever.
    const pages: Record<number, EmittedReference[]> = {
      1: [ref('https://a/1'), ref('https://a/2'), ref('https://a/3'), ref('https://a/4')],
      2: [ref('https://a/5')],
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

    const batch1 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2 })
    expect(batch1.references.map(r => r.canonicalUrl)).toEqual(['https://a/1', 'https://a/2'])
    expect(batch1.meta.nextCursor).toBeDefined()

    // Batch 2 comes from the REMAINDER of page 1 — no page advance.
    const batch2 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, cursor: batch1.meta.nextCursor })
    expect(batch2.references.map(r => r.canonicalUrl)).toEqual(['https://a/3', 'https://a/4'])
    expect(seenPages).toEqual([undefined, 1])

    // Page 1 exhausted → the next call advances to page 2 internally.
    const batch3 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, cursor: batch2.meta.nextCursor })
    expect(batch3.references.map(r => r.canonicalUrl)).toEqual(['https://a/5'])
    expect(seenPages).toEqual([undefined, 1, 1, 2])

    // Page 2 exhausted and page 3 empty → chain ends.
    const batch4 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, cursor: batch3.meta.nextCursor })
    expect(batch4.references).toEqual([])
    expect(batch4.meta.nextCursor).toBeUndefined()
    expect(seenPages).toEqual([undefined, 1, 1, 2, 2, 3])
  })

  it('cursor: rejects strings that did not come from meta.nextCursor', async () => {
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')])] })
    await expect(rk.search({ query: 'x', modalities: ['image'], cursor: 'not-a-cursor' })).rejects.toThrow(/invalid cursor/)
    await expect(rk.search({ query: 'x', modalities: ['image'], cursor: '{"v":9}' })).rejects.toThrow(/invalid cursor/)
    // Legacy v1 JSON cursors are short-lived load-more state, not durable ids —
    // they fail like any other foreign string instead of being migrated.
    await expect(rk.search({ query: 'x', modalities: ['image'], cursor: '{"v":1,"page":1,"seen":["abc"]}' })).rejects.toThrow(/invalid cursor/)
  })

  it('cursor: a bad caller-supplied controls.page fails loudly on the next call, not silently', async () => {
    // v1's zod decode rejected out-of-range pages when the cursor came back;
    // v2 must preserve that instead of wrapping to some other uint32 page.
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')])] })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], controls: { page: -1 } })
    expect(out.references).toHaveLength(1)
    await expect(rk.search({ query: 'x', modalities: ['image'], cursor: out.meta.nextCursor })).rejects.toThrow(/invalid cursor/)
  })

  it('cursor: seen never evicts the batch just returned, even when maxCursorSeen is smaller', async () => {
    // A cap below the batch size would re-show this batch on the very next
    // call and pagination would never converge.
    const refs = [ref('https://a/1'), ref('https://a/2'), ref('https://a/3'), ref('https://a/4')]
    const rk = createRefkit({ providers: [provider('a', refs)], maxCursorSeen: 1 })
    const batch1 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2 })
    expect(batch1.references.map(r => r.canonicalUrl)).toEqual(['https://a/1', 'https://a/2'])
    const batch2 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, cursor: batch1.meta.nextCursor })
    expect(batch2.references.map(r => r.canonicalUrl)).toEqual(['https://a/3', 'https://a/4'])
  })

  it('cursor: maxCursorSeen Infinity disables the cap instead of falling back to the default', async () => {
    // 501 results in one batch: the default cap would trim seen to 500.
    const many = Array.from({ length: 501 }, (_, i) => ref(`https://a/${i}`))
    const rk = createRefkit({ providers: [provider('a', many)], maxCursorSeen: Infinity })
    const batch = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 501 })
    expect(batch.references).toHaveLength(501)
    expect(decodeCursor(batch.meta.nextCursor!).seen).toHaveLength(501)
  })

  it('cursor: maxCursorSeen caps remembered keys (oldest evicted first)', async () => {
    const refs = [ref('https://a/1'), ref('https://a/2'), ref('https://a/3'), ref('https://a/4')]
    const rk = createRefkit({ providers: [provider('a', refs)], maxCursorSeen: 2 })
    const search = (cursor?: string) => rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 1, cursor })

    const batch1 = await search()
    const batch2 = await search(batch1.meta.nextCursor)
    const batch3 = await search(batch2.meta.nextCursor)
    expect(batch3.references.map(r => r.canonicalUrl)).toEqual(['https://a/3'])
    // Only the 2 most recent keys survive; batch1's key was evicted.
    expect(decodeCursor(batch3.meta.nextCursor!).seen).toEqual(
      [cursorSeenKey('https://a/2'), cursorSeenKey('https://a/3')],
    )
  })

  it('rejects a Promise passed as providers (un-awaited async factory)', () => {
    const promised = Promise.resolve([provider('a', [])])
    expect(() => createRefkit({ providers: promised as unknown as ReferenceProvider[] })).toThrow(/non-empty array/)
    promised.catch(() => {})
  })

  it('surfaces cross-source license conflicts as meta.warnings with conservative rights', async () => {
    const rk = createRefkit({
      providers: [
        provider('a', [ref('https://shared/1', 'CC-BY')]),
        provider('b', [ref('https://shared/1', 'CC-BY-NC')]),
      ],
    })
    const { references, meta } = await rk.searchWithMeta({ query: 'x', modalities: ['image'] })
    expect(references).toHaveLength(1)
    expect(references[0].rights.license).toBe('CC-BY-NC')
    expect(meta.warnings.some(w => w.includes('cross-source rights conflict'))).toBe(true)
  })

  it('concurrency bounds in-flight provider searches without changing results', async () => {
    let active = 0
    let maxActive = 0
    const slow = (id: string) => defineProvider({
      id,
      modalities: ['image'],
      search: async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise(r => setTimeout(r, 5))
        active--
        return [ref(`https://${id}/1`)]
      },
    })
    const providers = [slow('a'), slow('b'), slow('c'), slow('d')]
    const rk = createRefkit({ providers, concurrency: 2 })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(4)
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('queries only providers matching the modality', async () => {
    const textOnly = defineProvider({
      id: 't', modalities: ['text'],
      search: async () => { throw new Error('should not be called for an image search') },
    })
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), textOnly] })
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
      search: async (_q, ctx) => { capturedFetch = ctx.fetch; await ctx.fetch('https://cap/x'); return [] },
    })
    const rk = createRefkit({ providers: [capturingProvider] })
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(capturedFetch).not.toBe(globalThis.fetch) // wrapped by retryingFetch
    expect(globalFetchSpy.mock.calls[0]?.[0]).toBe('https://cap/x')
    globalFetchSpy.mockRestore()
  })

  it('injects a default User-Agent into provider fetches, and userAgent: false disables it', async () => {
    const seen: (string | null)[] = []
    const spy = vi.fn(async (_i: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('user-agent'))
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const calling = (headers?: Record<string, string>) => defineProvider({
      id: 'ua', modalities: ['image'],
      search: async (_q, ctx) => { await ctx.fetch('https://ua/x', headers ? { headers } : undefined); return [] },
    })
    await createRefkit({ providers: [calling()], fetch: spy }).search({ query: 'x', modalities: ['image'] })
    await createRefkit({ providers: [calling()], fetch: spy, userAgent: 'host/9' }).search({ query: 'x', modalities: ['image'] })
    await createRefkit({ providers: [calling({ 'User-Agent': 'prov/3' })], fetch: spy }).search({ query: 'x', modalities: ['image'] })
    await createRefkit({ providers: [calling()], fetch: spy, userAgent: false }).search({ query: 'x', modalities: ['image'] })
    expect(seen).toEqual(['refkit-client/1', 'host/9', 'prov/3', null])
  })

  it('resolves globalThis.fetch at search time, not at createRefkit time (late-binding)', async () => {
    // createRefkit is called BEFORE globalThis.fetch is replaced — a client that
    // resolved options.fetch ?? globalThis.fetch once at creation time would be
    // stuck delegating to the pre-replacement implementation forever.
    let capturedFetch: typeof fetch | undefined
    const capturingProvider = defineProvider({
      id: 'cap',
      modalities: ['image'],
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
    const imageOnly = provider('img', [ref('https://img/1')])
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
      search: async () => [{ modality: 'image' } as unknown as EmittedReference],
    })
    const goodProvider = provider('good', [ref('https://good/1')])
    const rk = createRefkit({ providers: [malformedProvider, goodProvider] })
    const out = await rk.search({ query: 'x', modalities: ['image'], onProviderError })
    expect(onProviderError).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'bad' }))
    expect(out.every(r => r.id !== '')).toBe(true)
    expect(out).toHaveLength(1)
  })

  it('search() applies lexicalReranker end-to-end, ordering by query relevance', async () => {
    const meadow = { ...ref('https://a/1'), title: 'a quiet meadow' }
    const city = { ...ref('https://a/2'), title: 'cyberpunk neon city' }
    const rk = createRefkit({ providers: [provider('a', [meadow, city])] })
    const out = await rk.search({ query: 'cyberpunk neon', modalities: ['image'], rerank: lexicalReranker() })
    expect(out[0].canonicalUrl).toBe('https://a/2')
  })

  const capturing = (sink: { limit?: number }, count: number) =>
    defineProvider({
      id: 'cap',
      modalities: ['image'],
      search: async (q) => {
        sink.limit = q.limit
        return Array.from({ length: count }, (_, i) => ref(`https://cap/${i}`))
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
      search: async (q) => { seenA = q.providerOptions; return [] },
    })
    const b = defineProvider({
      id: 'b',
      modalities: ['image'],
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
      search: async () => [],
    })
    const rk = createRefkit({
      providers: [
        provider('ok', [ref('https://ok/1', 'CC0-1.0'), ref('https://ok/2', 'proprietary')]),
        failing('bad'),
        textOnly,
      ],
    })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], gateFor: 'commercial-product' })

    expect(out.references.map(r => r.canonicalUrl)).toEqual(['https://ok/1'])
    expect(out.meta.providers).toEqual([
      { providerId: 'ok', status: 'fulfilled', returned: 2, accepted: 2, rejected: 0, latencyMs: expect.any(Number), confidence: 1 },
      { providerId: 'bad', status: 'failed', error: 'boom', latencyMs: expect.any(Number) },
      { providerId: 'text', status: 'skipped', reason: 'unsupported-modality' },
    ])
    expect(out.meta.gate).toEqual({ intent: 'commercial-product', before: 2, after: 1, dropped: 1 })
    expect(out.meta.warnings).toContain('1 provider(s) failed; returning partial results.')
  })

  it('does not count limit-truncated items as rejected — only schema-invalid items are rejected', async () => {
    const five = defineProvider({
      id: 'many',
      modalities: ['image'],
      search: async () => [
        ref('https://many/1'), ref('https://many/2'), ref('https://many/3'),
        ref('https://many/4'), ref('https://many/5'),
      ],
    })
    const rk = createRefkit({ providers: [five] })
    // poolFactor: 1 so fetchLimit === limit === 2 — the per-provider truncation
    // point — isolating "dropped by limit" from "dropped by overfetch pooling".
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, poolFactor: 1 })
    expect(out.meta.providers).toEqual([
      { providerId: 'many', status: 'fulfilled', returned: 5, accepted: 2, rejected: 0, latencyMs: expect.any(Number), confidence: 1 },
    ])
  })

  it('uses merge.isDuplicate to dedupe host-supplied fingerprints during search', async () => {
    // b is emitted first, so RRF ranks it above a; the survivor must be b.
    const a = { ...ref('https://a/1'), raw: { fingerprint: 'same' } }
    const b = { ...ref('https://a/2'), raw: { fingerprint: 'same' } }
    const rk = createRefkit({
      providers: [provider('a', [b, a])],
      merge: {
        isDuplicate: (candidate, existing) =>
          (candidate.raw as { fingerprint?: string }).fingerprint === (existing.raw as { fingerprint?: string }).fingerprint,
      },
    })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out.map(r => r.canonicalUrl)).toEqual(['https://a/2'])
  })

  it('searchWithMeta reports applied and ignored unified controls by provider', async () => {
    const controlled = defineProvider({
      id: 'controlled',
      modalities: ['image'],
      capabilities: { controls: ['orientation', 'color'] },
      search: async () => [ref('https://controlled/1')],
    })
    const plain = defineProvider({
      id: 'plain',
      modalities: ['image'],
      capabilities: { controls: [] },
      search: async () => [ref('https://plain/1')],
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

  it('reports every requested control as ignored by a provider that declares no capabilities', async () => {
    const bare = defineProvider({
      id: 'bare',
      modalities: ['image'],
      search: async () => [ref('https://bare/1')],
    })
    const rk = createRefkit({ providers: [bare] })
    const out = await rk.searchWithMeta({
      query: 'x',
      modalities: ['image'],
      controls: { orientation: 'landscape', color: 'blue' },
    })
    expect(out.meta.controls?.requested).toEqual(['orientation', 'color'])
    expect(out.meta.controls?.ignoredByProvider.bare).toEqual(['orientation', 'color'])
    // declares nothing → applies nothing (an undeclared control is never routed)
    expect(out.meta.controls?.appliedByProvider).toEqual({ bare: [] })
  })

  it('produces meta that validates against the exported searchMetaSchema', async () => {
    const skipped = defineProvider({ id: 'audio-only', modalities: ['audio'], search: async () => [] })
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), skipped] })
    const out = await rk.searchWithMeta({
      query: 'x',
      modalities: ['image'],
      controls: { orientation: 'landscape' },
      providerOptions: { a: { orderBy: 'latest' } },
      gateFor: 'commercial-product',
    })
    const parsed = searchMetaSchema.safeParse(out.meta)
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('times out a hanging provider, returns partial results, and reports the timeout', async () => {
    vi.useFakeTimers()
    try {
      const hanging = defineProvider({
        id: 'hang', modalities: ['image'],
        search: () => new Promise(() => {}), // never settles, ignores ctx.signal
      })
      const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), hanging] })
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
        id: 'wb', modalities: ['image'],
        search: (_q, ctx) => new Promise<EmittedReference[]>((_resolve, reject) => {
          ctx.signal?.addEventListener('abort', () => {
            observedAbort = true
            reject(ctx.signal?.reason ?? new Error('aborted'))
          })
        }),
      })
      const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), wellBehaved] })
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
        id: 'slow', modalities: ['image'],
        search: () => new Promise(resolve => setTimeout(() => { done = true; resolve([ref('https://s/1')]) }, 60_000)),
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
        id: 'ignorer', modalities: ['image'],
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
      id: 'net', modalities: ['image'],
      search: async (_q, ctx) => {
        const res = await ctx.fetch('https://net/api', { signal: ctx.signal })
        if (!res.ok) throw new Error(`net failed: ${res.status}`)
        return [ref('https://net/1')]
      },
    })
    const rk = createRefkit({ providers: [usesFetch], fetch: upstream as unknown as typeof fetch, resilience: { retries: 1, timeoutMs: 10_000 } })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(1)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('reports latencyMs on fulfilled and failed providers, not on skipped', async () => {
    const textOnly = defineProvider({ id: 'text', modalities: ['text'], search: async () => [] })
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), failing('bad'), textOnly] })
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
      id: 'c', modalities: ['image'],
      search: async () => { calls++; return [ref('https://c/1')] },
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
      id: 'c', modalities: ['image'],
      search: async () => { calls++; return [ref('https://c/1')] },
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
      id: 'c', modalities: ['image'],
      search: async () => { calls++; return [ref('https://c/1')] },
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
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')])], cache: broken })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(1)
  })

  it('honors a custom cacheTtlMs', async () => {
    const cache = mapCache()
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')])], cache, cacheTtlMs: 1234 })
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(cache.ttls).toEqual([1234])
  })

  it('a cache hit still flows through the license gate (hits are pre-merge; the gate stays live)', async () => {
    const cache = mapCache()
    const rk = createRefkit({ providers: [provider('a', [ref('https://a/1', 'proprietary')])], cache })
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
        providers: [provider('a', [ref('https://a/1')])],
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
      id: 'c', modalities: ['image'],
      search: async () => { calls++; return [ref('https://c/1')] },
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
        id: 'c', modalities: ['image'],
        search: async () => [ref('https://c/1')],
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
      id: 'c', modalities: ['image'],
      search: async () => [ref('https://c/1')],
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] }) // live search, populates cache
    // seed the cache entry with 1 valid + 1 malformed item (keep the {q, refs} envelope)
    for (const k of cache.store.keys()) {
      const payload = JSON.parse(cache.store.get(k)!)
      cache.store.set(k, JSON.stringify({ ...payload, refs: [...payload.refs, { id: '', modality: 'image' }] }))
    }
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], onProviderError })
    expect(out.references.map(r => r.canonicalUrl)).toEqual(['https://c/1'])
    expect(out.meta.providers[0]).toMatchObject({ cached: true, returned: 2, accepted: 1, rejected: 1 })
    expect(onProviderError).toHaveBeenCalledTimes(1)
    expect(onProviderError).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'c' }))
  })

  it('stableStringify cache keys treat undefined-valued keys the same as absent keys', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'],
      search: async () => { calls++; return [ref('https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'], providerOptions: { c: { a: 1, b: undefined } } })
    await rk.search({ query: 'x', modalities: ['image'], providerOptions: { c: { a: 1 } } })
    expect(calls).toBe(1) // second search hits the same cache entry as the first
  })

  describe('sources filter', () => {
    it('restricts the fan-out to the requested source ids; others are skipped as not-selected', async () => {
      let bCalled = false
      const a = provider('a', [ref('https://a/1')])
      const b = defineProvider({
        id: 'b', modalities: ['image'],
        search: async () => { bCalled = true; return [ref('https://b/1')] },
      })
      const rk = createRefkit({ providers: [a, b] })
      const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], sources: ['a'] })
      expect(out.references.map(r => r.canonicalUrl)).toEqual(['https://a/1'])
      expect(bCalled).toBe(false) // never queried — its query is untouched
      expect(out.meta.providers.find(s => s.providerId === 'b')).toEqual({ providerId: 'b', status: 'skipped', reason: 'not-selected' })
    })

    it('a modality miss stays unsupported-modality; only a source exclusion is not-selected', async () => {
      // b matches the modality but is filtered out by sources → not-selected.
      // text never matches the modality → unsupported-modality, regardless of sources.
      const a = provider('a', [ref('https://a/1')])
      const b = provider('b', [ref('https://b/1')])
      const textOnly = defineProvider({ id: 'text', modalities: ['text'], search: async () => [] })
      const rk = createRefkit({ providers: [a, b, textOnly] })
      const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], sources: ['a'] })
      const byId = Object.fromEntries(out.meta.providers.map(s => [s.providerId, s]))
      expect(byId.b).toMatchObject({ status: 'skipped', reason: 'not-selected' })
      expect(byId.text).toMatchObject({ status: 'skipped', reason: 'unsupported-modality' })
    })

    it('throws a clear Error (not AggregateError) when sources match no configured provider', async () => {
      const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')])] })
      await expect(rk.search({ query: 'x', modalities: ['image'], sources: ['nope'] })).rejects.toThrow(
        'refkit.search: no configured provider matches source id(s) [nope] for modalities [image]',
      )
      await expect(rk.search({ query: 'x', modalities: ['image'], sources: ['nope'] })).rejects.not.toBeInstanceOf(AggregateError)
    })

    it('throws the source-miss error when the requested source exists but not for this modality', async () => {
      const imageOnly = provider('img', [ref('https://img/1')])
      const textOnly = defineProvider({ id: 'txt', modalities: ['text'], search: async () => [] })
      const rk = createRefkit({ providers: [imageOnly, textOnly] })
      // txt is registered, but scoping an image search to [txt] has an empty intersection
      await expect(rk.search({ query: 'x', modalities: ['image'], sources: ['txt'] })).rejects.toThrow(
        /no configured provider matches source id\(s\) \[txt\]/,
      )
    })

    it('warns about unknown source ids while still searching the ones that resolved', async () => {
      const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')])] })
      const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], sources: ['a', 'ghost'] })
      expect(out.references).toHaveLength(1)
      expect(out.meta.warnings).toContain('unknown source id(s) ignored: ghost.')
    })

    it('does not warn when every requested source id resolves', async () => {
      const rk = createRefkit({ providers: [provider('a', [ref('https://a/1')]), provider('b', [ref('https://b/1')])] })
      const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'], sources: ['a', 'b'] })
      expect(out.meta.warnings.some(w => w.includes('unknown source'))).toBe(false)
    })

    it('coexists with the load-more cursor across a round-trip (page/seen stay global)', async () => {
      const pages: Record<number, EmittedReference[]> = {
        1: [ref('https://a/1'), ref('https://a/2'), ref('https://a/3'), ref('https://a/4')],
        2: [ref('https://a/5')],
      }
      const paging = defineProvider({
        id: 'a', modalities: ['image'], capabilities: { controls: ['page'] },
        search: async (q) => pages[q.controls?.page ?? 1] ?? [],
      })
      let otherCalled = false
      const other = defineProvider({
        id: 'b', modalities: ['image'],
        search: async () => { otherCalled = true; return [ref('https://b/1')] },
      })
      const rk = createRefkit({ providers: [paging, other] })

      const batch1 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, sources: ['a'] })
      expect(batch1.references.map(r => r.canonicalUrl)).toEqual(['https://a/1', 'https://a/2'])
      expect(batch1.meta.nextCursor).toBeDefined()

      // sources is re-supplied alongside the cursor (it is not encoded in the cursor)
      const batch2 = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 2, sources: ['a'], cursor: batch1.meta.nextCursor })
      expect(batch2.references.map(r => r.canonicalUrl)).toEqual(['https://a/3', 'https://a/4'])
      expect(batch2.references.every(r => !batch1.references.some(b => b.canonicalUrl === r.canonicalUrl))).toBe(true)
      expect(otherCalled).toBe(false) // b stayed excluded across both pages
    })
  })
})

describe('kind-aware routing', () => {
  const kindProvider = (id: string, kinds: readonly string[], refs: EmittedReference[]) =>
    defineProvider({ id, modalities: ['image'], kinds, search: async () => refs })

  it('skips providers whose declared kinds lack the requested value', async () => {
    const rk = createRefkit({ providers: [
      kindProvider('tex', ['texture'], [ref('https://t/1')]),
      kindProvider('ph', ['photo'], [ref('https://p/1')]),
    ] })
    const { references, meta } = await rk.searchWithMeta({
      query: 'x', modalities: ['image'], controls: { media: { kind: 'texture' } },
    })
    expect(references.map(r => r.canonicalUrl)).toEqual(['https://t/1'])
    expect(meta.providers.find(p => p.providerId === 'ph'))
      .toMatchObject({ status: 'skipped', reason: 'unsupported-kind' })
  })

  it('conservatively includes providers that declare no kinds', async () => {
    const rk = createRefkit({ providers: [
      provider('legacy', [ref('https://l/1')]), // no kinds declared
      kindProvider('ph', ['photo'], [ref('https://p/1')]),
    ] })
    const out = await rk.search({
      query: 'x', modalities: ['image'], controls: { media: { kind: 'texture' } },
    })
    expect(out.map(r => r.canonicalUrl)).toEqual(['https://l/1'])
  })

  it('throws with the kind in the message when nothing matches', async () => {
    const rk = createRefkit({ providers: [kindProvider('ph', ['photo'], [])] })
    await expect(rk.search({
      query: 'x', modalities: ['image'], controls: { media: { kind: 'texture' } },
    })).rejects.toThrow('kind "texture"')
  })
})

// A CC-BY record whose source terms are narrower than the label implies: same
// license id, different facts — the cross-source conflict the merge reports.
const narrowCcBy = { commercialUse: false, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: false } as const
type NarrowFacts = typeof narrowCcBy

// Per-pass provider sleep, long enough that two passes' summed latency is
// unmistakably above one pass's (see the cursor-advance test).
const STEADY_SLEEP_MS = 30

describe('multi-pass fidelity, deadline and gate context', () => {
  it('cursor advance accumulates pass diagnostics instead of overwriting them', async () => {
    // provider `flaky` fails on page 1 and succeeds on page 2; `steady` returns the same
    // single item on every page so page 1's pool is exhausted after the first call.
    let calls = 0
    const flaky = defineProvider({
      id: 'flaky', modalities: ['image'], capabilities: { controls: ['page'] },
      search: async (q) => {
        calls++
        if ((q.controls?.page ?? 1) === 1) throw new Error('boom')
        return [ref('https://f.test/2')]
      },
    })
    const steady = defineProvider({
      id: 'steady', modalities: ['image'], capabilities: { controls: ['page'] },
      search: async () => {
        await new Promise(r => setTimeout(r, STEADY_SLEEP_MS))
        return [ref('https://s.test/1')]
      },
    })
    const rk = createRefkit({ providers: [flaky, steady], resilience: false })
    const first = await rk.searchWithMeta({ query: 'q', modalities: ['image'], limit: 5 })
    expect(first.meta.passes).toBe(1)
    const second = await rk.searchWithMeta({ query: 'q', modalities: ['image'], limit: 5, cursor: first.meta.nextCursor })
    expect(second.meta.passes).toBeGreaterThan(1)
    expect(second.meta.warnings.some(w => /pass 1: 1 provider\(s\) failed/.test(w))).toBe(true)
    expect(second.references.map(r => r.canonicalUrl)).toEqual(['https://f.test/2'])
    expect(calls).toBeGreaterThan(1)
    // Latency is SUMMED over every pass, so a multi-pass call never under-reports
    // it: `steady` slept STEADY_SLEEP_MS on each of the two passes, a total one
    // pass alone could not reach.
    expect(second.meta.providers.find(p => p.providerId === 'steady')?.latencyMs)
      .toBeGreaterThan(STEADY_SLEEP_MS * 1.5)
  })

  it('concatenates rights conflicts across passes, deduped by URL', async () => {
    const item = (url: string, facts?: NarrowFacts): EmittedReference => ({
      modality: 'image', sourceUrl: url,
      rights: { license: 'CC-BY', ...(facts ? { facts } : {}), rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
    })
    // page 2 repeats shared/1 (already returned) and adds shared/2
    const source = (id: string, facts?: NarrowFacts) => defineProvider({
      id, modalities: ['image'], capabilities: { controls: ['page'] },
      search: async (q) => (q.controls?.page ?? 1) === 1
        ? [item('https://shared/1', facts)]
        : [item('https://shared/1', facts), item('https://shared/2', facts)],
    })
    const rk = createRefkit({ providers: [source('a'), source('b', narrowCcBy)] })
    const first = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 1 })
    expect(first.references.map(r => r.canonicalUrl)).toEqual(['https://shared/1'])
    const second = await rk.searchWithMeta({ query: 'x', modalities: ['image'], limit: 1, cursor: first.meta.nextCursor })
    expect(second.meta.passes).toBe(2)
    const conflicts = second.meta.warnings.filter(w => w.includes('conflict'))
    // shared/1 conflicts on BOTH passes but is warned about once; shared/2 only on pass 2
    expect(conflicts).toEqual([
      'cross-source rights conflict for https://shared/1: CC-BY declared with differing facts → resolved to CC-BY.',
      'cross-source rights conflict for https://shared/2: CC-BY declared with differing facts → resolved to CC-BY.',
    ])
  })

  it('names a same-label facts conflict as such instead of "CC-BY → resolved to CC-BY"', async () => {
    const url = 'https://shared/x'
    const emitWith = (facts?: NarrowFacts): EmittedReference => ({
      modality: 'image', sourceUrl: url,
      rights: { license: 'CC-BY', ...(facts ? { facts } : {}), rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
    })
    const rk = createRefkit({ providers: [
      defineProvider({ id: 'a', modalities: ['image'], search: async () => [emitWith()] }),
      defineProvider({ id: 'b', modalities: ['image'], search: async () => [emitWith(narrowCcBy)] }),
    ] })
    const { meta } = await rk.searchWithMeta({ query: 'x', modalities: ['image'] })
    expect(meta.warnings).toContain(`cross-source rights conflict for ${url}: CC-BY declared with differing facts → resolved to CC-BY.`)
  })

  it('deadlineMs bounds the whole search and reports hung providers as failed', async () => {
    const hung = defineProvider({
      id: 'hung', modalities: ['image'],
      search: (_q, ctx) => new Promise<EmittedReference[]>((_, reject) => {
        ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason))
      }),
    })
    const fast = defineProvider({ id: 'fast', modalities: ['image'], search: async () => [ref('https://x.test/1')] })
    const rk = createRefkit({ providers: [hung, fast], resilience: false })
    const started = Date.now()
    const { references, meta } = await rk.searchWithMeta({ query: 'q', modalities: ['image'], deadlineMs: 100 })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(references).toHaveLength(1)
    expect(meta.providers.find(p => p.providerId === 'hung')?.status).toBe('failed')
  })

  it('gateContext forwards the user jurisdiction to the search-time gate', async () => {
    const url = 'https://x.test/us'
    const us = defineProvider({
      id: 'us', modalities: ['image'],
      search: async () => [{
        modality: 'image', sourceUrl: url,
        rights: { license: 'PD', jurisdiction: 'US', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
      }],
    })
    const rk = createRefkit({ providers: [us], resilience: false })
    const open = await rk.search({ query: 'q', modalities: ['image'], gateFor: 'commercial-product' })
    const gated = await rk.search({ query: 'q', modalities: ['image'], gateFor: 'commercial-product', gateContext: { userJurisdiction: 'DE' } })
    expect(open).toHaveLength(1)
    expect(gated).toHaveLength(0)
  })
})

describe('accuracy defaults', () => {
  const titled = (url: string, title: string, extra: Partial<EmittedReference> = {}) => ({ ...ref(url), title, ...extra })

  it('a source whose batch never mentions the query sinks below a source that does', async () => {
    const noise = defineProvider({
      id: 'noise', modalities: ['image'],
      search: async () => ['お客様ネイル', '親指', 'ネイル'].map((t, i) => titled(`https://n.test/${i}`, t)),
    })
    const signal = defineProvider({
      id: 'signal', modalities: ['image'],
      search: async () => [titled('https://s.test/1', 'A lion')],
    })
    const rk = createRefkit({ providers: [noise, signal], resilience: false, rerank: false })
    const { references, meta } = await rk.searchWithMeta({ query: 'lion', modalities: ['image'] })
    // Raw RRF would put noise's rank-0 item first; the confidence weight sinks
    // the whole batch to a tenth of its contribution instead.
    expect(references[0].source.providerId).toBe('signal')
    expect(meta.providers.find(p => p.providerId === 'noise')?.confidence).toBeCloseTo(0.1, 5)
    expect(meta.providers.find(p => p.providerId === 'signal')?.confidence).toBe(1)
  })

  it('under the shipped defaults the trustworthy source wins an equal lexical hit', async () => {
    // Both sources return a ref titled "A lion" for the query "lion"; noise's
    // even carries a resolution edge. Confidence only reaches the ranking through
    // the reranker's fusionWeight, so without it the default reranker would hand
    // the top slot to the mostly-irrelevant source.
    const signal = defineProvider({
      id: 'signal', modalities: ['image'],
      search: async () => [titled('https://s.test/1', 'A lion')],
    })
    const noise = defineProvider({
      id: 'noise', modalities: ['image'],
      search: async () => [
        titled('https://n.test/0', 'A lion', { visual: { width: 4000, height: 3000 } }),
        titled('https://n.test/1', 'Unrelated thing'),
        titled('https://n.test/2', 'Unrelated thing'),
        titled('https://n.test/3', 'Unrelated thing'),
      ],
    })
    const { references, meta } = await createRefkit({ providers: [signal, noise] })
      .searchWithMeta({ query: 'lion', modalities: ['image'], limit: 10 })
    // Confidence: signal 1 (1/1 hit), noise 0.1 + 0.9·0.25 = 0.325. Fusion (k=60,
    // rank 0, max-normalised): signal 1, noise's lion 0.325. Equal lexical 1, so
    // base(signal) = 1 + 0.5·1 + 0.15·0.5 = 1.575 beats
    // base(noise) = 1 + 0.5·0.325 + 0.15·1 = 1.3125 despite the resolution edge.
    expect(references[0].source.providerId).toBe('signal')
    expect(meta.providers.find(p => p.providerId === 'signal')?.confidence).toBeCloseTo(1, 5)
    expect(meta.providers.find(p => p.providerId === 'noise')?.confidence).toBeCloseTo(0.325, 5)
  })

  it('sourceConfidence: false leaves the fusion unweighted', async () => {
    const noise = defineProvider({
      id: 'noise', modalities: ['image'],
      search: async () => [titled('https://n.test/1', 'ネイル')],
    })
    const signal = defineProvider({
      id: 'signal', modalities: ['image'],
      search: async () => [titled('https://s.test/1', 'A lion')],
    })
    const rk = createRefkit({ providers: [noise, signal], resilience: false, rerank: false, sourceConfidence: false })
    const { references, meta } = await rk.searchWithMeta({ query: 'lion', modalities: ['image'] })
    expect(references[0].source.providerId).toBe('noise') // rank-0 tie, input order
    expect(meta.providers.every(p => p.confidence === undefined)).toBe(true)
  })

  it('omits confidence for a fulfilled provider that returned nothing', async () => {
    // There is nothing to rate: an empty batch neither mentions the query nor
    // fails to, so reporting the 1 that keeps the weights array parallel would
    // read as "fully trusted".
    const empty = defineProvider({ id: 'empty', modalities: ['image'], search: async () => [] })
    const p = defineProvider({
      id: 'p', modalities: ['image'],
      search: async () => [titled('https://x.test/1', 'A lion')],
    })
    const { meta } = await createRefkit({ providers: [empty, p], resilience: false })
      .searchWithMeta({ query: 'lion', modalities: ['image'] })
    const status = meta.providers.find(s => s.providerId === 'empty')
    expect(status).toEqual({ providerId: 'empty', status: 'fulfilled', returned: 0, accepted: 0, rejected: 0, latencyMs: expect.any(Number) })
    expect(meta.providers.find(s => s.providerId === 'p')?.confidence).toBe(1)
  })

  it('a custom confidence floor deepens the dampening', async () => {
    const noise = defineProvider({
      id: 'noise', modalities: ['image'],
      search: async () => [titled('https://n.test/1', 'ネイル')],
    })
    const rk = createRefkit({ providers: [noise], resilience: false, sourceConfidence: { floor: 0.5 } })
    const { meta } = await rk.searchWithMeta({ query: 'lion', modalities: ['image'] })
    expect(meta.providers[0].confidence).toBeCloseTo(0.5, 5)
  })

  it('the lexical reranker runs by default and rerank:false restores raw fusion order', async () => {
    const p = defineProvider({
      id: 'p', modalities: ['image'],
      search: async () => [titled('https://x.test/1', 'Something else'), titled('https://x.test/2', 'A lion')],
    })
    const dflt = await createRefkit({ providers: [p], resilience: false })
      .search({ query: 'lion', modalities: ['image'] })
    expect(dflt[0].canonicalUrl).toBe('https://x.test/2')
    const raw = await createRefkit({ providers: [p], resilience: false })
      .search({ query: 'lion', modalities: ['image'], rerank: false })
    expect(raw[0].canonicalUrl).toBe('https://x.test/1')
  })

  it('options.rerank replaces the default reranker; a per-call reranker overrides it', async () => {
    const p = defineProvider({
      id: 'p', modalities: ['image'],
      search: async () => [titled('https://x.test/1', 'Something else'), titled('https://x.test/2', 'A lion')],
    })
    const reverse = createRefkit({ providers: [p], resilience: false, rerank: ({ refs }) => [...refs].reverse() })
    expect((await reverse.search({ query: 'lion', modalities: ['image'] }))[0].canonicalUrl).toBe('https://x.test/2')
    const perCall = await reverse.search({
      query: 'lion', modalities: ['image'], rerank: ({ refs }) => [...refs],
    })
    expect(perCall[0].canonicalUrl).toBe('https://x.test/1')
    // options.rerank: false is the client-wide off switch
    const off = createRefkit({ providers: [p], resilience: false, rerank: false })
    expect((await off.search({ query: 'lion', modalities: ['image'] }))[0].canonicalUrl).toBe('https://x.test/1')
  })

  it('minRelevance drops low-scoring results and reports the count', async () => {
    const p = defineProvider({
      id: 'p', modalities: ['image'],
      search: async () => [titled('https://x.test/1', 'A lion'), titled('https://x.test/2', 'Unrelated')],
    })
    const { references, meta } = await createRefkit({ providers: [p], resilience: false })
      .searchWithMeta({ query: 'lion', modalities: ['image'], minRelevance: 0.5 })
    // The blend is lexical 1 + fusion 1 + quality 0.5 over total 1.65 → 0.95 for
    // the match, and fusion-only 0.98 + quality over 1.65 → 0.34 for the miss.
    expect(references.map(r => r.canonicalUrl)).toEqual(['https://x.test/1'])
    expect(meta.threshold).toEqual({ minRelevance: 0.5, dropped: 1 })
    expect(meta.warnings).toContain('1 result(s) below minRelevance 0.5.')
    const parsed = searchMetaSchema.safeParse(meta)
    expect(parsed.error?.issues ?? []).toEqual([])
  })

  it('a non-finite minRelevance is ignored instead of dropping everything', async () => {
    const p = defineProvider({
      id: 'p', modalities: ['image'],
      search: async () => [titled('https://x.test/1', 'A lion')],
    })
    const { references, meta } = await createRefkit({ providers: [p], resilience: false })
      .searchWithMeta({ query: 'lion', modalities: ['image'], minRelevance: NaN })
    expect(references).toHaveLength(1)
    expect(meta.threshold).toBeUndefined()
  })
})
