import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { RefkitClient, Reference } from '@refkit/core'

const MODALITIES = ['image', 'video', 'audio', 'text'] as const
const INTENTS = ['internal-moodboard', 'commercial-product', 'ai-generation-input', 'redistribution'] as const

// Concise, agent-facing projection of a Reference (no raw provider dump).
function toAgentRef(r: Reference) {
  return {
    id: r.id,
    title: r.title,
    modality: r.modality,
    provider: r.source.providerId,
    canonicalUrl: r.canonicalUrl,
    license: r.rights.license,
    thumbnail: r.thumbnail?.url,
    excerpt: r.text?.excerpt,
  }
}

const agentRefSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  modality: z.string(),
  provider: z.string(),
  canonicalUrl: z.string(),
  license: z.string(),
  thumbnail: z.string().optional(),
  excerpt: z.string().optional(),
})

/** Wrap a configured RefkitClient as an MCP server exposing `search_references`. */
export function createRefkitMcpServer(refkit: RefkitClient): McpServer {
  const server = new McpServer({ name: 'refkit', version: '0.0.0' })

  server.registerTool(
    'search_references',
    {
      title: 'Search creative references',
      description:
        'Search license-normalized reference material (images / text) across the configured clean sources. ' +
        'Every result carries a license id + canonical source link. Pass gateFor to return only results usable ' +
        'for a given intent (license-gated). Results are references, not rights clearance — not legal advice.',
      inputSchema: {
        query: z.string().describe('what to search for, e.g. "cyberpunk alley at night"'),
        modalities: z.array(z.enum(MODALITIES)).optional().describe('default ["image"]'),
        limit: z.number().int().positive().optional(),
        gateFor: z.enum(INTENTS).optional().describe('only return results allowed for this intended use'),
      },
      outputSchema: { references: z.array(agentRefSchema) },
    },
    async ({ query, modalities, limit, gateFor }) => {
      const refs = await refkit.search({ query, modalities: modalities ?? ['image'], limit, gateFor })
      const references = refs.map(toAgentRef)
      return {
        content: [{ type: 'text', text: `${references.length} reference(s) for "${query}".` }],
        structuredContent: { references },
      }
    },
  )

  return server
}

/** Run the refkit MCP server over stdio (host wires the RefkitClient + its providers/keys). */
export async function serveStdio(refkit: RefkitClient): Promise<void> {
  const server = createRefkitMcpServer(refkit)
  await server.connect(new StdioServerTransport())
}
