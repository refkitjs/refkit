import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRefkit, defineProvider } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { readFileSync } from 'node:fs'
import { createRefkitMcpServer } from '../index'
import { defaultProviders, maxCursorSeenFromEnv, BYOK_SOURCES } from '../cli'

const OPENVERSE = { results: [
  { id: 'aaa', title: 'cc0 sky', creator: 'Alice', foreign_landing_url: 'https://ov/aaa', url: 'https://cdn/aaa.jpg', thumbnail: 'https://ov/aaa/thumb', width: 10, height: 10, license: 'cc0', license_version: '1.0', license_url: 'https://cc/cc0' },
] }
const CC_BY = { results: [
  { id: 'bbb', title: 'attribution pic', creator: 'Bob', foreign_landing_url: 'https://ov/bbb', url: 'https://cdn/bbb.jpg', thumbnail: 'https://ov/bbb/thumb', width: 10, height: 10, license: 'by', license_version: '4.0', license_url: 'https://cc/by' },
] }

async function clientForPayload(payload: unknown) {
  const fakeFetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch
  const refkit = createRefkit({ providers: [openverse()], fetch: fakeFetch })
  const server = createRefkitMcpServer(refkit)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([client.connect(clientT), server.connect(serverT)])
  return client
}

const connectedClient = () => clientForPayload(OPENVERSE)

describe('@refkit/mcp', () => {
  it('lists the search_references tool', async () => {
    const client = await connectedClient()
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name)).toContain('search_references')
    await client.close()
  })

  it('search_references returns license-normalized structured references', async () => {
    const client = await connectedClient()
    const res = await client.callTool({ name: 'search_references', arguments: { query: 'sky', modalities: ['image'] } })
    const structured = res.structuredContent as { references: Array<{ title?: string; license: string; canonicalUrl: string; provider: string }> }
    expect(structured.references).toHaveLength(1)
    expect(structured.references[0].title).toBe('cc0 sky')
    expect(structured.references[0].license).toBe('CC0-1.0')
    expect(structured.references[0].canonicalUrl).toBe('https://ov/aaa')
    expect(structured.references[0].provider).toBe('openverse')
    await client.close()
  })

  it('gateFor flows through to the license gate', async () => {
    const client = await connectedClient()
    // cc0 is commercial-allowed, so it survives the gate
    const res = await client.callTool({ name: 'search_references', arguments: { query: 'sky', modalities: ['image'], gateFor: 'commercial-product' } })
    const structured = res.structuredContent as { references: Array<{ useVerdict?: { decision: string } }> }
    expect(structured.references).toHaveLength(1)
    // gateFor also annotates survivors with their verdict (assessIntent = intent ?? gateFor)
    expect(structured.references[0].useVerdict?.decision).toBe('allowed')
    await client.close()
  })

  it('intent annotates each result with a use-verdict (no filtering)', async () => {
    const client = await connectedClient()
    const res = await client.callTool({ name: 'search_references', arguments: { query: 'sky', modalities: ['image'], intent: 'commercial-product' } })
    const structured = res.structuredContent as { references: Array<{ useVerdict?: { decision: string; confidence: string }; attribution?: string }> }
    expect(structured.references).toHaveLength(1)
    expect(structured.references[0].useVerdict?.decision).toBe('allowed') // cc0 → commercial allowed
    expect(structured.references[0].useVerdict?.confidence).toBe('high')
    expect(structured.references[0].attribution).toBeUndefined() // cc0 needs no attribution
    await client.close()
  })

  it('omits the verdict when neither intent nor gateFor is given (bare projection)', async () => {
    const client = await connectedClient()
    const res = await client.callTool({ name: 'search_references', arguments: { query: 'sky', modalities: ['image'] } })
    const structured = res.structuredContent as { references: Array<{ useVerdict?: unknown }> }
    expect(structured.references[0].useVerdict).toBeUndefined()
    await client.close()
  })

  it('a CC-BY result carries a use-verdict + attribution credit line under an intent', async () => {
    const client = await clientForPayload(CC_BY)
    const res = await client.callTool({ name: 'search_references', arguments: { query: 'x', modalities: ['image'], intent: 'commercial-product' } })
    const structured = res.structuredContent as { references: Array<{ useVerdict?: { decision: string }; attribution?: string }> }
    expect(structured.references[0].useVerdict?.decision).toBe('allowed-with-attribution')
    expect(structured.references[0].attribution).toContain('CC-BY')
    await client.close()
  })

  it('returns nextCursor at the top level WITHOUT explain, and the cursor round-trips', async () => {
    const item = (i: number) => ({
      id: `pg:${i}`,
      modality: 'image' as const,
      source: { providerId: 'pg', sourceUrl: `https://pg/${i}` },
      canonicalUrl: `https://pg/${i}`,
      rights: { license: 'CC0-1.0' as const, rehostPolicy: 'cache-allowed' as const, raw: { sourceTerms: 't', sourceUrl: `https://pg/${i}` } },
      verifiedAt: '2026-06-22T00:00:00.000Z',
      relevance: 0,
    })
    const pool = Array.from({ length: 6 }, (_, i) => item(i + 1))
    const paging = defineProvider({
      id: 'pg',
      modalities: ['image'],
      capabilities: { controls: ['page'] },
      search: async (q) => {
        const size = q.limit ?? 20
        const page = q.controls?.page ?? 1
        return pool.slice((page - 1) * size, page * size)
      },
    })
    const server = createRefkitMcpServer(createRefkit({ providers: [paging] }))
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([client.connect(clientT), server.connect(serverT)])

    type Out = { references: Array<{ canonicalUrl: string }>; nextCursor?: string; meta?: unknown }
    const batch1 = (await client.callTool({ name: 'search_references', arguments: { query: 'x', modalities: ['image'], limit: 2 } })).structuredContent as Out
    expect(batch1.references).toHaveLength(2)
    expect(batch1.nextCursor).toBeDefined() // present WITHOUT explain
    expect(batch1.meta).toBeUndefined() // meta dump still gated by explain

    const batch2 = (await client.callTool({ name: 'search_references', arguments: { query: 'x', modalities: ['image'], limit: 2, cursor: batch1.nextCursor } })).structuredContent as Out
    expect(batch2.references).toHaveLength(2)
    const urls1 = batch1.references.map(r => r.canonicalUrl)
    expect(batch2.references.every(r => !urls1.includes(r.canonicalUrl))).toBe(true) // no repeats
    await client.close()
  })

  it('accepts filters and providerOptions for provider-specific search controls', async () => {
    let seen: { filters?: unknown; providerOptions?: unknown } = {}
    const fakeProvider = defineProvider({
      id: 'fake',
      modalities: ['image'],
      capabilities: { controls: ['orientation'] },
      search: async (q) => {
        seen = { filters: q.filters, providerOptions: q.providerOptions }
        return []
      },
    })
    const server = createRefkitMcpServer(createRefkit({ providers: [fakeProvider] }))
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([client.connect(clientT), server.connect(serverT)])
    await client.callTool({
      name: 'search_references',
      arguments: {
        query: 'sky',
        modalities: ['image'],
        filters: { orientation: 'landscape' },
        providerOptions: { fake: { sort: 'latest' } },
      },
    })
    expect(seen.filters).toEqual({ orientation: 'landscape' })
    expect(seen.providerOptions).toEqual({ sort: 'latest' })
    await client.close()
  })

  it('accepts unified controls and forwards them to core search', async () => {
    let seen: unknown
    const fakeProvider = defineProvider({
      id: 'fake',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      capabilities: { controls: ['orientation', 'color', 'safety'] },
      search: async (q) => {
        seen = q.controls
        return []
      },
    })
    const server = createRefkitMcpServer(createRefkit({ providers: [fakeProvider] }))
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([client.connect(clientT), server.connect(serverT)])
    await client.callTool({
      name: 'search_references',
      arguments: {
        query: 'sky',
        modalities: ['image'],
        controls: { orientation: 'landscape', color: 'blue', safety: 'strict' },
      },
    })
    expect(seen).toEqual({ orientation: 'landscape', color: 'blue', safety: 'strict' })
    await client.close()
  })

  it('includes control support metadata when explain is true', async () => {
    const fakeProvider = defineProvider({
      id: 'fake',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      capabilities: { controls: ['orientation'] },
      search: async () => [],
    })
    const server = createRefkitMcpServer(createRefkit({ providers: [fakeProvider] }))
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([client.connect(clientT), server.connect(serverT)])
    const res = await client.callTool({
      name: 'search_references',
      arguments: {
        query: 'sky',
        modalities: ['image'],
        controls: { orientation: 'landscape', color: 'blue' },
        explain: true,
      },
    })
    const structured = res.structuredContent as {
      meta?: {
        controls?: {
          requested: string[]
          appliedByProvider: Record<string, string[]>
          ignoredByProvider: Record<string, string[]>
        }
      }
    }
    expect(structured.meta?.controls).toEqual({
      requested: ['orientation', 'color'],
      appliedByProvider: { fake: ['orientation'] },
      ignoredByProvider: { fake: ['color'] },
    })
    await client.close()
  })

  it('forwards sources to core, restricting which providers are searched', async () => {
    let aCalled = false
    let bCalled = false
    const a = defineProvider({ id: 'a', modalities: ['image'], queryFeatures: ['keyword'], search: async () => { aCalled = true; return [] } })
    const b = defineProvider({ id: 'b', modalities: ['image'], queryFeatures: ['keyword'], search: async () => { bCalled = true; return [] } })
    const server = createRefkitMcpServer(createRefkit({ providers: [a, b] }))
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([client.connect(clientT), server.connect(serverT)])
    await client.callTool({ name: 'search_references', arguments: { query: 'x', modalities: ['image'], sources: ['a'] } })
    expect(aCalled).toBe(true)
    expect(bCalled).toBe(false)
    await client.close()
  })

  it('advertises the enabled source ids in the sources parameter description', async () => {
    const client = await connectedClient() // openverse-only server
    const { tools } = await client.listTools()
    const tool = tools.find(t => t.name === 'search_references')!
    const properties = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties
    expect(properties.sources?.description).toContain('openverse')
    await client.close()
  })

  it('surfaces a source-selection miss as an agent-friendly tool error listing valid ids', async () => {
    const client = await connectedClient() // openverse-only server
    const res = await client.callTool({ name: 'search_references', arguments: { query: 'x', modalities: ['image'], sources: ['nope'] } })
    expect(res.isError).toBe(true)
    const text = (res.content as Array<{ type: string; text: string }>).map(c => c.text).join('\n')
    expect(text).toContain('nope') // the offending request is echoed back
    expect(text).toContain('openverse') // and the valid id is surfaced
    await client.close()
  })

  it('returns meta and use explanations when explain is true', async () => {
    const good = defineProvider({
      id: 'good',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async () => [{
        id: 'good-1',
        modality: 'image',
        title: 'credit me',
        source: { providerId: 'good', sourceUrl: 'https://good/1' },
        canonicalUrl: 'https://good/1',
        rights: { license: 'CC-BY', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 'terms', sourceUrl: 'https://good/1' } },
        verifiedAt: '2026-06-22T00:00:00.000Z',
        relevance: 1,
      }],
    })
    const bad = defineProvider({
      id: 'bad',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      search: async () => { throw new Error('offline') },
    })
    const server = createRefkitMcpServer(createRefkit({ providers: [good, bad] }))
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([client.connect(clientT), server.connect(serverT)])

    const res = await client.callTool({
      name: 'search_references',
      arguments: { query: 'credit', modalities: ['image'], intent: 'commercial-product', explain: true },
    })
    const structured = res.structuredContent as {
      references: Array<{ useExplanation?: string }>
      meta?: { providers: Array<{ providerId: string; status: string; error?: string; latencyMs?: number }>; warnings: string[] }
    }
    expect(structured.references[0].useExplanation).toContain('allowed-with-attribution')
    expect(structured.meta?.providers).toEqual([
      { providerId: 'good', status: 'fulfilled', returned: 1, accepted: 1, rejected: 0, latencyMs: expect.any(Number) },
      { providerId: 'bad', status: 'failed', error: 'offline', latencyMs: expect.any(Number) },
    ])
    expect(structured.meta?.warnings).toContain('1 provider(s) failed; returning partial results.')
    await client.close()
  })
})

describe('evaluate_use tool', () => {
  it('lists the evaluate_use and build_attribution tools', async () => {
    const client = await connectedClient()
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name)).toContain('evaluate_use')
    expect(tools.map(t => t.name)).toContain('build_attribution')
    await client.close()
  })

  it('CC-BY under commercial-product → allowed-with-attribution, with attribution.text containing the author', async () => {
    const client = await connectedClient()
    const res = await client.callTool({
      name: 'evaluate_use',
      arguments: {
        license: 'CC-BY',
        author: 'Alice',
        title: 'attribution pic',
        canonicalUrl: 'https://ov/bbb',
        intent: 'commercial-product',
      },
    })
    const structured = res.structuredContent as {
      decision: string
      reasons: string[]
      confidence: string
      disclaimer: string
      attribution?: { text?: string }
    }
    expect(structured.decision).toBe('allowed-with-attribution')
    expect(structured.attribution?.text).toContain('Alice')
    await client.close()
  })

  it('unknown license → needs-review', async () => {
    const client = await connectedClient()
    const res = await client.callTool({
      name: 'evaluate_use',
      arguments: {
        license: 'unknown',
        canonicalUrl: 'https://example.com/x',
        intent: 'commercial-product',
      },
    })
    const structured = res.structuredContent as { decision: string }
    expect(structured.decision).toBe('needs-review')
    await client.close()
  })

  it('CC0 editorialOnly + commercial-product intent → denied', async () => {
    const client = await connectedClient()
    const res = await client.callTool({
      name: 'evaluate_use',
      arguments: {
        license: 'CC0-1.0',
        editorialOnly: true,
        canonicalUrl: 'https://example.com/editorial',
        intent: 'commercial-product',
      },
    })
    const structured = res.structuredContent as { decision: string }
    expect(structured.decision).toBe('denied')
    await client.close()
  })

  it('PD with mismatched jurisdiction + commercial-product intent → needs-review', async () => {
    const client = await connectedClient()
    const res = await client.callTool({
      name: 'evaluate_use',
      arguments: {
        license: 'PD',
        jurisdiction: 'US',
        userJurisdiction: 'DE',
        canonicalUrl: 'https://example.com/pd',
        intent: 'commercial-product',
      },
    })
    const structured = res.structuredContent as { decision: string }
    expect(structured.decision).toBe('needs-review')
    await client.close()
  })
})

describe('build_attribution tool', () => {
  it('CC0 → required false', async () => {
    const client = await connectedClient()
    const res = await client.callTool({
      name: 'build_attribution',
      arguments: {
        license: 'CC0-1.0',
        canonicalUrl: 'https://example.com/cc0',
      },
    })
    const structured = res.structuredContent as { required: boolean; text?: string }
    expect(structured.required).toBe(false)
    await client.close()
  })

  it('CC-BY-NC with version → text contains "CC-BY-NC 2.0"', async () => {
    const client = await connectedClient()
    const res = await client.callTool({
      name: 'build_attribution',
      arguments: {
        license: 'CC-BY-NC',
        licenseVersion: '2.0',
        author: 'Carol',
        canonicalUrl: 'https://example.com/nc',
      },
    })
    const structured = res.structuredContent as { required: boolean; text?: string }
    expect(structured.required).toBe(true)
    expect(structured.text).toContain('CC-BY-NC 2.0')
    await client.close()
  })

  it('non-CC license id: licenseVersion is dropped silently (bare license label, no text emitted)', async () => {
    const client = await connectedClient()
    const res = await client.callTool({
      name: 'build_attribution',
      arguments: {
        license: 'unsplash',
        licenseVersion: '4.0',
        canonicalUrl: 'https://example.com/unsplash',
      },
    })
    const structured = res.structuredContent as { required: boolean; text?: string }
    // unsplash requires no attribution at all, so text is absent — but critically,
    // the version must never have been threaded through un-gated (it isn't a CC family).
    expect(structured.text ?? '').not.toContain('4.0')
    await client.close()
  })
})

describe('maxCursorSeenFromEnv (cursor size knob for size-clamped tool outputs)', () => {
  it('parses a positive integer REFKIT_MAX_CURSOR_SEEN', () => {
    expect(maxCursorSeenFromEnv({})).toBeUndefined()
    expect(maxCursorSeenFromEnv({ REFKIT_MAX_CURSOR_SEEN: '200' })).toBe(200)
  })

  it('warns on stderr and falls back to the core default on garbage values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Strict decimal digits only — Number()'s hex/exponent/whitespace/sign
      // leniency must not slip through ('1e100' would defeat the cap entirely,
      // and a beyond-safe-integer literal can't be represented faithfully).
      const garbage = ['0', '-5', '2.5', 'abc', '0x10', '1e3', ' 5 ', '+7', '1e100', '9007199254740993']
      for (const bad of garbage) {
        expect(maxCursorSeenFromEnv({ REFKIT_MAX_CURSOR_SEEN: bad }), bad).toBeUndefined()
      }
      expect(spy).toHaveBeenCalledTimes(garbage.length)
      // '' means unset: no warning.
      expect(maxCursorSeenFromEnv({ REFKIT_MAX_CURSOR_SEEN: '' })).toBeUndefined()
      expect(spy).toHaveBeenCalledTimes(garbage.length)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('defaultProviders (zero-config CLI wiring)', () => {
  it('includes every keyless provider by default', async () => {
    const ids = (await defaultProviders({})).map(p => p.id)
    for (const id of ['openverse', 'wikimedia-commons', 'met', 'artic', 'gutendex', 'poetrydb', 'rijksmuseum', 'polyhaven', 'ambientcg', 'internet-archive', 'nailbook']) {
      expect(ids).toContain(id)
    }
  })

  it('adds a BYOK provider only when its env key is present', async () => {
    expect((await defaultProviders({})).map(p => p.id)).not.toContain('unsplash')
    expect((await defaultProviders({ UNSPLASH_KEY: 'k' })).map(p => p.id)).toContain('unsplash')
  })

  it('adds a BYOK provider when only the unified REFKIT_ env key is present', async () => {
    expect((await defaultProviders({ REFKIT_UNSPLASH_KEY: 'k' })).map(p => p.id)).toContain('unsplash')
  })

  it('adds freesound only when FREESOUND_TOKEN is present', async () => {
    expect((await defaultProviders({})).map(p => p.id)).not.toContain('freesound')
    expect((await defaultProviders({ FREESOUND_TOKEN: 'k' })).map(p => p.id)).toContain('freesound')
  })

  it('adds jamendo only when JAMENDO_CLIENT_ID is present', async () => {
    expect((await defaultProviders({})).map(p => p.id)).not.toContain('jamendo')
    expect((await defaultProviders({ JAMENDO_CLIENT_ID: 'k' })).map(p => p.id)).toContain('jamendo')
  })

  it('adds europeana only when EUROPEANA_KEY is present', async () => {
    expect((await defaultProviders({})).map(p => p.id)).not.toContain('europeana')
    expect((await defaultProviders({ EUROPEANA_KEY: 'k' })).map(p => p.id)).toContain('europeana')
  })

  it('adds europeana when only the unified REFKIT_EUROPEANA_KEY is present', async () => {
    expect((await defaultProviders({ REFKIT_EUROPEANA_KEY: 'k' })).map(p => p.id)).toContain('europeana')
  })

  it('adds smithsonian via the legacy SI_KEY name (no unified alias renames the id)', async () => {
    expect((await defaultProviders({})).map(p => p.id)).not.toContain('smithsonian')
    expect((await defaultProviders({ SI_KEY: 'k' })).map(p => p.id)).toContain('smithsonian')
  })

  it('BYOK_SOURCES and package.json optionalDependencies stay in sync', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      optionalDependencies?: Record<string, string>
      dependencies?: Record<string, string>
    }
    const optional = Object.keys(pkg.optionalDependencies ?? {}).sort()
    const table = BYOK_SOURCES.map(s => s.pkg).sort()
    // an entry in one but not the other ships a source that either can never
    // load (missing dep) or never installs for a purpose (dep without loader)
    expect(table).toEqual(optional)
    // and no BYOK package may ALSO be a hard dependency
    for (const p of table) expect(pkg.dependencies ?? {}).not.toHaveProperty(p)
  })
})
