import { describe, expect, it, vi } from 'vitest'
import { createRefkit } from '../client'
import { defineProvider } from '../provider'
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
    let capturedFetch: typeof fetch | undefined
    const capturingProvider = defineProvider({
      id: 'cap',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async (_q, ctx) => { capturedFetch = ctx.fetch; return [] },
    })
    const rk = createRefkit({ providers: [capturingProvider] })
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(capturedFetch).toBe(globalThis.fetch)
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
})
