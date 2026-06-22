import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRefkit } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { createRefkitMcpServer } from '../index'

const OPENVERSE = { results: [
  { id: 'aaa', title: 'cc0 sky', creator: 'Alice', foreign_landing_url: 'https://ov/aaa', url: 'https://cdn/aaa.jpg', thumbnail: 'https://ov/aaa/thumb', width: 10, height: 10, license: 'cc0', license_version: '1.0', license_url: 'https://cc/cc0' },
] }
const fakeFetch = (async () => new Response(JSON.stringify(OPENVERSE), { status: 200 })) as typeof fetch

async function connectedClient() {
  const refkit = createRefkit({ providers: [openverse()], fetch: fakeFetch })
  const server = createRefkitMcpServer(refkit)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([client.connect(clientT), server.connect(serverT)])
  return client
}

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
    const structured = res.structuredContent as { references: unknown[] }
    expect(structured.references).toHaveLength(1)
    await client.close()
  })
})
