import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { LICENSE_IDS, INTENTS, evaluateUse, buildAttribution, ccVersionFor, buildSearchControlsSchema, searchMetaSchema } from '@refkit/core'
import type { RefkitClient, Reference, Verdict, Attribution, SearchControls, ProviderOptionsById, RightsRecord, Modality } from '@refkit/core'

// Legacy media.kind control values — kept in the dynamic enum because they stay
// meaningful as upstream filter translations for providers that support the
// media.kind control without declaring kinds.
const BASE_MEDIA_KINDS = ['photo', 'illustration', 'vector', 'film', 'animation'] as const

const providerOptionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
const providerOptionsSchema = z.record(z.string(), z.record(z.string(), providerOptionValueSchema))

// Reported in the MCP initialize handshake. Read the real version (the dist sits
// next to package.json, which npm always ships) instead of a hardcoded placeholder.
const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

// Concise, agent-facing projection of a Reference (no raw provider dump). When an
// intent is supplied the use-gate verdict + attribution ride along, so the agent
// sees *whether it may use* each result — not just a bare license id it ignores.
function toAgentRef(r: Reference, assessment?: { verdict: Verdict; attribution: Attribution }) {
  const base = {
    id: r.id,
    title: r.title,
    modality: r.modality,
    kind: r.kind,
    provider: r.source.providerId,
    canonicalUrl: r.canonicalUrl,
    license: r.rights.license,
    thumbnail: r.thumbnail?.url,
    excerpt: r.text?.excerpt,
  }
  if (!assessment) return base
  const { verdict, attribution } = assessment
  const reason = verdict.reasons.join('; ')
  const useExplanation = `${verdict.decision}: ${reason || 'license facts allow this use'}${attribution.required && attribution.text ? ` Attribution required: ${attribution.text}` : ''}`
  return {
    ...base,
    useVerdict: { decision: verdict.decision, reason: verdict.reasons.join('; '), confidence: verdict.confidence },
    useExplanation,
    ...(attribution.required && attribution.text ? { attribution: attribution.text } : {}),
  }
}

const agentRefSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  modality: z.string(),
  kind: z.string().optional().describe('fine-grained resource kind, e.g. photo / texture / ebook'),
  provider: z.string(),
  canonicalUrl: z.string(),
  license: z.string(),
  thumbnail: z.string().optional(),
  excerpt: z.string().optional(),
  useVerdict: z
    .object({ decision: z.string(), reason: z.string(), confidence: z.string() })
    .optional()
    .describe('present when `intent` (or `gateFor`) is set: may this be used for that intent, and how confident'),
  useExplanation: z.string().optional().describe('plain-language use verdict summary for agents'),
  attribution: z.string().optional().describe('ready-to-use credit line; present when the license requires attribution'),
})

/** Wrap a configured RefkitClient as an MCP server exposing `search_references`. */
export function createRefkitMcpServer(refkit: RefkitClient): McpServer {
  const server = new McpServer({ name: 'refkit', version: VERSION })
  // Enumerated in the `sources` param description so an agent knows the valid ids
  // up front (and reused to enrich a source-miss error). Providers are fixed for
  // the server's lifetime, so this snapshot never drifts.
  const enabledSourceIds = refkit.providers.map(p => p.id)

  const registered = refkit.providers
  const modalityValues = [...new Set(registered.flatMap(p => p.modalities))] as [Modality, ...Modality[]]
  const kindValues = [...new Set<string>([...BASE_MEDIA_KINDS, ...registered.flatMap(p => p.kinds ?? [])])] as [string, ...string[]]
  const sourceList = registered.map(p => {
    const kinds = p.kinds?.length ? `·${p.kinds.join(',')}` : ''
    const desc = p.description ? `: ${p.description}` : ''
    return `- ${p.id} (${p.modalities.join('/')}${kinds})${desc}`
  }).join('\n')
  const searchControlsSchema = buildSearchControlsSchema(kindValues)

  server.registerTool(
    'search_references',
    {
      title: 'Search creative references',
      description:
        'Search license-normalized reference material (image / video / audio / text) across the configured sources. ' +
        'Every result carries a license id + canonical source link. Pass `intent` to annotate each result with a ' +
        'use-verdict (may I use this, is attribution required) WITHOUT filtering; pass `gateFor` to instead return ' +
        'only results whose license allows that intent. Results are references, not rights clearance — not legal advice.' +
        '\n\nConfigured sources:\n' + sourceList,
      inputSchema: {
        query: z.string().describe('what to search for, e.g. "cyberpunk alley at night"'),
        modalities: z.array(z.enum(modalityValues)).optional().describe('default ["image"]'),
        sources: z.array(z.string()).optional().describe(
          'restrict the search to specific sources by id (omit to search every configured source — see "Configured sources" in this tool description). '
          + 'Use to scope a search-engine operator (e.g. "site:example.com") to a web-discovery source without affecting other sources\' queries.',
        ),
        controls: searchControlsSchema.optional().describe('provider-neutral search controls; providers translate supported controls and report ignored controls in explain metadata'),
        providerOptions: providerOptionsSchema.optional().describe('provider-specific search controls keyed by provider id; each provider whitelists supported keys'),
        explain: z.boolean().optional().describe('include provider status, applied and ignored controls, warnings, gate/drop metadata, and the load-more cursor'),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional().describe('opaque cursor from a previous result\'s nextCursor — fetches the next batch, deduped against earlier batches'),
        rerank: z.boolean().optional().describe('re-rank results by query relevance (term coverage incl. CJK over title/description/tags/excerpt, fused cross-source relevance, resolution, source and near-duplicate diversity). Default true — pass false for raw cross-source rank fusion. true cannot re-enable reranking when the host built the client with rerank: false'),
        intent: z.enum(INTENTS).optional().describe('annotate each result with a use-verdict for this intended use (no filtering)'),
        gateFor: z.enum(INTENTS).optional().describe('only return results whose license allows this intended use'),
      },
      outputSchema: {
        references: z.array(agentRefSchema),
        nextCursor: z.string().optional().describe('pass back as `cursor` for the next batch; absent = exhausted'),
        meta: searchMetaSchema.optional(),
      },
    },
    async ({ query, modalities, controls, providerOptions, explain, limit, cursor, rerank, intent, gateFor, sources }) => {
      const searchInput = {
        query,
        modalities: modalities ?? ['image'],
        sources,
        controls: controls as SearchControls | undefined,
        providerOptions: providerOptions as ProviderOptionsById | undefined,
        limit,
        cursor,
        // Core reranks by default; only an explicit false turns it off.
        ...(rerank === false ? { rerank: false as const } : {}),
        gateFor,
      }
      // Always searchWithMeta: the continuation token (meta.nextCursor) must not
      // depend on the explain diagnostics flag — only the meta DUMP is gated.
      let result
      try {
        result = await refkit.searchWithMeta(searchInput)
      } catch (err) {
        // A source-selection miss (no requested id resolves for the modality) is a
        // caller mistake, not an outage — turn core's throw into an agent-actionable
        // tool error listing the valid ids. AggregateError (every chosen provider
        // failed at fetch) is a genuine upstream fault, so let it propagate.
        if (sources && sources.length > 0 && !(err instanceof AggregateError)) {
          const available = enabledSourceIds.join(', ') || '(none)'
          const detail = err instanceof Error ? err.message : String(err)
          return {
            isError: true,
            content: [{ type: 'text', text: `${detail} Enabled source ids: ${available}.` }],
          }
        }
        throw err
      }
      const refs = result.references
      const assessIntent = intent ?? gateFor
      const references = refs.map(r =>
        assessIntent
          ? toAgentRef(r, { verdict: refkit.evaluateUse(r, assessIntent), attribution: refkit.buildAttribution(r) })
          : toAgentRef(r),
      )
      return {
        content: [{ type: 'text', text: `${references.length} reference(s) for "${query}".` }],
        structuredContent: {
          references,
          ...(result.meta.nextCursor ? { nextCursor: result.meta.nextCursor } : {}),
          ...(explain ? { meta: result.meta } : {}),
        },
      }
    },
  )

  const attributionOutputSchema = { required: z.boolean(), text: z.string().optional(), html: z.string().optional() }

  server.registerTool(
    'evaluate_use',
    {
      title: 'Evaluate a license for an intended use',
      description:
        'Stateless license/use-gate check: given a license id + intended use, returns a conservative-heuristic verdict ' +
        '(allowed / allowed-with-attribution / denied / needs-review) with reasons and confidence. ' +
        'Not legal advice — a strict-deny heuristic over source-declared license facts.',
      inputSchema: {
        license: z.enum(LICENSE_IDS).describe('the reference\'s license id'),
        licenseVersion: z.string().optional().describe('precise CC version, e.g. "4.0" — attribution only'),
        author: z.string().optional(),
        title: z.string().optional(),
        canonicalUrl: z.string().describe('canonical source link, for attribution and audit'),
        intent: z.enum(INTENTS).describe('the intended use to evaluate this license against'),
        editorialOnly: z.boolean().optional().describe('source marked editorial-only'),
        jurisdiction: z.string().optional().describe('source-declared jurisdiction of the PD/copyright status'),
        userJurisdiction: z.string().optional().describe('caller\'s jurisdiction; mismatched jurisdictions default to needs-review'),
      },
      outputSchema: {
        decision: z.enum(['allowed', 'allowed-with-attribution', 'denied', 'needs-review']),
        reasons: z.array(z.string()),
        confidence: z.enum(['high', 'low']),
        disclaimer: z.string(),
        attribution: z.object(attributionOutputSchema).optional(),
      },
    },
    async ({ license, licenseVersion, author, title, canonicalUrl, intent, editorialOnly, jurisdiction, userJurisdiction }) => {
      const version = ccVersionFor(license, licenseVersion)
      const rights: RightsRecord = {
        license,
        licenseVersion: version,
        author,
        rehostPolicy: 'cache-allowed',
        jurisdiction,
        editorialOnly,
        raw: { sourceTerms: '', sourceUrl: canonicalUrl },
      }
      const verdict: Verdict = evaluateUse(rights, intent, { userJurisdiction })
      const attribution =
        verdict.decision === 'allowed-with-attribution'
          ? buildAttribution({ license, licenseVersion: version, author, title, canonicalUrl })
          : undefined
      const summary = `${verdict.decision}: ${verdict.reasons.join('; ') || 'license facts allow this use'}`
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          decision: verdict.decision,
          reasons: verdict.reasons,
          confidence: verdict.confidence,
          disclaimer: verdict.disclaimer,
          ...(attribution ? { attribution } : {}),
        },
      }
    },
  )

  server.registerTool(
    'build_attribution',
    {
      title: 'Build an attribution credit line',
      description:
        'Mechanically derive an attribution credit line (plain text + HTML) from a license id + author + title + ' +
        'canonicalUrl. `required` is false when the license needs no attribution (e.g. CC0, PD).',
      inputSchema: {
        license: z.enum(LICENSE_IDS),
        licenseVersion: z.string().optional().describe('precise CC version, e.g. "4.0" — appended to the license name'),
        author: z.string().optional(),
        title: z.string().optional(),
        canonicalUrl: z.string(),
      },
      outputSchema: attributionOutputSchema,
    },
    async ({ license, licenseVersion, author, title, canonicalUrl }) => {
      const version = ccVersionFor(license, licenseVersion)
      const attribution: Attribution = buildAttribution({ license, licenseVersion: version, author, title, canonicalUrl })
      return {
        content: [{ type: 'text', text: attribution.required ? (attribution.text ?? '') : 'No attribution required for this license.' }],
        structuredContent: { required: attribution.required, text: attribution.text, html: attribution.html },
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
