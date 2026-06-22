import { describe, expect, it } from 'vitest'
import { defineProvider, type ProviderContext, type NormalizedQuery } from '../provider'
import type { Reference } from '../reference'

// Factory pattern: key in the closure, NOT the interface. Proves the provider is
// implementable and that it uses the injected ctx.fetch (core stays zero-network).
const fakeUnsplash = (cfg: { accessKey: string }) => defineProvider({
  id: 'fake-unsplash',
  modalities: ['image'],
  queryFeatures: ['keyword', 'orientation'],
  async search(query: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
    await ctx.fetch('https://example.test/search?key=' + cfg.accessKey + '&q=' + encodeURIComponent(query.text))
    return []
  },
})

describe('ReferenceProvider / defineProvider', () => {
  it('is implementable via a factory and uses the injected fetch', async () => {
    let called = ''
    const provider = fakeUnsplash({ accessKey: 'k123' })
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        called = String(input)
        return new Response('[]')
      }) as typeof fetch,
    }
    const out = await provider.search({ text: 'cat', modalities: ['image'] }, ctx)
    expect(out).toEqual([])
    expect(called).toContain('q=cat')
    expect(called).toContain('key=k123')
  })

  it('defineProvider returns its input unchanged (identity helper)', () => {
    const p = defineProvider({ id: 'x', modalities: ['text'], queryFeatures: [], search: async () => [] })
    expect(p.id).toBe('x')
  })
})
