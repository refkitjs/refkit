import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { LICENSE_IDS, INTENTS, evaluateUse, buildAttribution, ccVersionFor } from '@refkit/core'
import type { RefkitClient, Reference, Verdict, Attribution, SearchFilters, SearchControls, SearchControlKey, ProviderOptionsById, SearchMeta, RightsRecord } from '@refkit/core'

const MODALITIES = ['image', 'video', 'audio', 'text'] as const
const ORIENTATIONS = ['landscape', 'portrait', 'square'] as const
const SEARCH_CONTROL_KEYS = [
  'orientation',
  'color',
  'language',
  'sort',
  'safety',
  'license.commercial',
  'license.modification',
  'license.allowUnknown',
  'media.kind',
  'media.size',
  'media.minWidth',
  'media.minHeight',
  'media.duration',
  'creator.id',
  'creator.name',
  'text.copyright',
  'page',
] as const satisfies readonly SearchControlKey[]

const filtersSchema = z.object({
  color: z.string().optional(),
  orientation: z.enum(ORIENTATIONS).optional(),
  language: z.string().optional(),
})
const searchControlKeySchema = z.enum(SEARCH_CONTROL_KEYS)

const searchControlsSchema = z.object({
  orientation: z.enum(ORIENTATIONS).optional(),
  color: z.string().optional(),
  language: z.string().optional(),
  sort: z.enum(['relevance', 'latest', 'popular', 'interesting']).optional(),
  safety: z.enum(['strict', 'moderate', 'off']).optional(),
  license: z.object({
    commercial: z.boolean().optional(),
    modification: z.boolean().optional(),
    allowUnknown: z.boolean().optional(),
  }).optional(),
  media: z.object({
    kind: z.enum(['photo', 'illustration', 'vector', 'film', 'animation']).optional(),
    size: z.enum(['small', 'medium', 'large']).optional(),
    minWidth: z.number().int().nonnegative().optional(),
    minHeight: z.number().int().nonnegative().optional(),
    duration: z.enum(['short', 'medium', 'long']).optional(),
  }).optional(),
  creator: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  text: z.object({
    copyright: z.enum(['public-domain', 'copyrighted', 'any']).optional(),
  }).optional(),
  page: z.number().int().positive().optional(),
})

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

const searchMetaSchema: z.ZodType<SearchMeta> = z.object({
  query: z.string(),
  modalities: z.array(z.enum(MODALITIES)),
  limit: z.number(),
  poolFactor: z.number(),
  fetchLimit: z.number(),
  appliedFilters: filtersSchema.optional(),
  controls: z.object({
    requested: z.array(searchControlKeySchema),
    appliedByProvider: z.record(z.string(), z.array(searchControlKeySchema)),
    ignoredByProvider: z.record(z.string(), z.array(searchControlKeySchema)),
  }).optional(),
  providerOptions: z.array(z.string()).optional(),
  providers: z.array(z.object({
    providerId: z.string(),
    status: z.enum(['fulfilled', 'failed', 'skipped']),
    returned: z.number().optional(),
    accepted: z.number().optional(),
    rejected: z.number().optional(),
    reason: z.enum(['unsupported-modality']).optional(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
    cached: z.boolean().optional(),
  })),
  gate: z.object({
    intent: z.enum(INTENTS),
    before: z.number(),
    after: z.number(),
    dropped: z.number(),
  }).optional(),
  warnings: z.array(z.string()),
})

/** Wrap a configured RefkitClient as an MCP server exposing `search_references`. */
export function createRefkitMcpServer(refkit: RefkitClient): McpServer {
  const server = new McpServer({ name: 'refkit', version: VERSION })

  server.registerTool(
    'search_references',
    {
      title: 'Search creative references',
      description:
        'Search license-normalized reference material (image / video / audio / text) across the configured sources. ' +
        'Every result carries a license id + canonical source link. Pass `intent` to annotate each result with a ' +
        'use-verdict (may I use this, is attribution required) WITHOUT filtering; pass `gateFor` to instead return ' +
        'only results whose license allows that intent. Results are references, not rights clearance — not legal advice.',
      inputSchema: {
        query: z.string().describe('what to search for, e.g. "cyberpunk alley at night"'),
        modalities: z.array(z.enum(MODALITIES)).optional().describe('default ["image"]'),
        filters: filtersSchema.optional().describe('compatibility alias for controls.orientation, controls.color, and controls.language'),
        controls: searchControlsSchema.optional().describe('provider-neutral search controls; providers translate supported controls and report ignored controls in explain metadata'),
        providerOptions: providerOptionsSchema.optional().describe('provider-specific search controls keyed by provider id; each provider whitelists supported keys'),
        explain: z.boolean().optional().describe('include provider status, applied and ignored controls, warnings, and gate/drop metadata'),
        limit: z.number().int().positive().optional(),
        intent: z.enum(INTENTS).optional().describe('annotate each result with a use-verdict for this intended use (no filtering)'),
        gateFor: z.enum(INTENTS).optional().describe('only return results whose license allows this intended use'),
      },
      outputSchema: { references: z.array(agentRefSchema), meta: searchMetaSchema.optional() },
    },
    async ({ query, modalities, filters, controls, providerOptions, explain, limit, intent, gateFor }) => {
      const searchInput = {
        query,
        modalities: modalities ?? ['image'],
        filters: filters as SearchFilters | undefined,
        controls: controls as SearchControls | undefined,
        providerOptions: providerOptions as ProviderOptionsById | undefined,
        limit,
        gateFor,
      }
      const result = explain ? await refkit.searchWithMeta(searchInput) : { references: await refkit.search(searchInput), meta: undefined }
      const refs = result.references
      const assessIntent = intent ?? gateFor
      const references = refs.map(r =>
        assessIntent
          ? toAgentRef(r, { verdict: refkit.evaluateUse(r, assessIntent), attribution: refkit.buildAttribution(r) })
          : toAgentRef(r),
      )
      return {
        content: [{ type: 'text', text: `${references.length} reference(s) for "${query}".` }],
        structuredContent: { references, ...(result.meta ? { meta: result.meta } : {}) },
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
