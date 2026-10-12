import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { LICENSE_IDS, INTENTS, REHOST_POLICIES, isSourceSelectionError, evaluateUse, buildAttribution, ccVersionFor, buildSearchControlsSchema, searchMetaSchema } from '@refkit/core'
import type { RefkitClient, Reference, Verdict, Attribution, SearchControls, SearchInput, SourceOptionsById, RightsRecord, Modality } from '@refkit/core'

// Legacy media.kind control values — kept in the dynamic enum because they stay
// meaningful as upstream filter translations for providers that support the
// media.kind control without declaring kinds.
const BASE_MEDIA_KINDS = ['photo', 'illustration', 'vector', 'film', 'animation'] as const

const providerOptionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
const sourceOptionsSchema = z.record(z.string(), z.record(z.string(), providerOptionValueSchema))

// Reported in the MCP initialize handshake. Read the real version (the dist sits
// next to package.json, which npm always ships) instead of a hardcoded placeholder.
const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

// Agent context is the scarce resource: descriptions are capped and tags trimmed to the
// leading few (sources list the most specific subjects first).
const AGENT_DESCRIPTION_MAX = 280
const AGENT_TAGS_MAX = 8

function capText(text: string | undefined, max: number): string | undefined {
  if (text === undefined || text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

// Concise, agent-facing projection of a Reference (no raw provider dump). When an
// intent is supplied the use-gate verdict + attribution ride along, so the agent
// sees *whether it may use* each result — not just a bare license id it ignores.
// `sourceScore` stays out on purpose: it is in each source's own scale and only orders
// results within one source; `relevance` is the cross-source score an agent can compare.
// It stays a flat projection of the Reference union: `durationSec` from the audio or
// video metadata, and `width`/`height` from `visual` (the original's size), else from
// the preview rendition's size (its aspect ratio is the original's).
function toAgentRef(r: Reference, assessment?: { verdict: Verdict; attribution: Attribution }) {
  const size = r.visual ?? r.preview
  const base = {
    id: r.id,
    title: r.title,
    description: capText(r.description, AGENT_DESCRIPTION_MAX),
    tags: r.tags && r.tags.length > 0 ? r.tags.slice(0, AGENT_TAGS_MAX) : undefined,
    modality: r.modality,
    kind: r.kind,
    source: r.source.id,
    canonicalUrl: r.canonicalUrl,
    license: r.rights.license,
    author: r.rights.author,
    rehostPolicy: r.rights.rehostPolicy,
    relevance: Math.round(r.relevance * 1000) / 1000,
    thumbnail: r.thumbnail?.url,
    excerpt: r.text?.excerpt,
    durationSec: r.audio?.durationSec ?? r.video?.durationSec,
    width: size?.width,
    height: size?.height,
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
  description: z.string().optional().describe(`the source's own caption or description, capped at ${AGENT_DESCRIPTION_MAX} characters`),
  tags: z.array(z.string()).optional().describe(`the source's subjects or tags, first ${AGENT_TAGS_MAX}`),
  modality: z.string(),
  kind: z.string().optional().describe('fine-grained resource kind, e.g. photo / texture / ebook'),
  source: z.string().describe('id of the source this result came from (see "Configured sources")'),
  canonicalUrl: z.string(),
  license: z.string(),
  author: z.string().optional().describe('creator as declared by the source'),
  rehostPolicy: z.enum(REHOST_POLICIES).describe(
    'what the source lets you do with the media file — respect it before downloading or storing anything: '
    + 'hotlink-required = link to canonicalUrl, never copy the file; cache-allowed = you may download and cache it; '
    + 'thumbnail-only = you may store the thumbnail but not the full file; no-store = store nothing, not even the thumbnail',
  ),
  relevance: z.number().describe('0..1 cross-source relevance after fusion/rerank; compare results by this'),
  thumbnail: z.string().optional(),
  excerpt: z.string().optional(),
  durationSec: z.number().optional().describe('length in seconds (audio and video), when the source reports it'),
  width: z.number().optional().describe('width in pixels: the original\'s when the source reports it, else the preview rendition\'s (same aspect ratio)'),
  height: z.number().optional().describe('height in pixels: the original\'s when the source reports it, else the preview rendition\'s (same aspect ratio)'),
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
        'only results whose license allows that intent. Results are references, not rights clearance — not legal advice. ' +
        'Before downloading or storing a result\'s media, follow its `rehostPolicy` (some sources only allow hotlinking or thumbnails).' +
        '\n\nConfigured sources:\n' + sourceList,
      inputSchema: {
        query: z.string().describe('what to search for, e.g. "cyberpunk alley at night"'),
        modalities: z.array(z.enum(modalityValues)).optional().describe('default ["image"]'),
        sources: z.array(z.string()).optional().describe(
          'restrict the search to specific sources by id (omit to search every configured source — see "Configured sources" in this tool description). '
          + 'Use to scope a search-engine operator (e.g. "site:example.com") to a web-discovery source without affecting other sources\' queries.',
        ),
        controls: searchControlsSchema.optional().describe('provider-neutral search controls; providers translate supported controls and report ignored controls in explain metadata'),
        sourceOptions: sourceOptionsSchema.optional().describe('source-specific search options keyed by source id; each source whitelists the keys it supports'),
        explain: z.boolean().optional().describe('include per-source status, applied and ignored controls, warnings, gate/drop metadata, and the load-more cursor'),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional().describe('opaque cursor from a previous result\'s nextCursor — fetches the next batch, deduped against earlier batches'),
        rerank: z.boolean().optional().describe('re-rank results by query relevance (term coverage incl. CJK over title/description/tags/excerpt, fused cross-source relevance, resolution, source and near-duplicate diversity). Default true — pass false for raw cross-source rank fusion. true cannot re-enable reranking when the host built the client with rerank: false'),
        minRelevance: z.number().min(0).max(1).optional().describe(
          'drop results the ranker scored below this, after reranking. Graded against the reranker\'s blended score, where a result matching no query term lands around 0.3 under the stock weights — so 0.5 keeps only real matches. Off by default (a bar can empty the batch). Does NOT transfer to rerank: false, where raw fusion is max-normalised and the top result is always 1',
        ),
        deadlineMs: z.number().int().positive().optional().describe(
          'whole-search deadline in ms, cursor page advances included (unlike the host\'s per-source timeout, which bounds one source search). Sources still in flight when it fires are reported as failed and the rest are returned; a hard bound while the host leaves per-source resilience on (the default), and otherwise only binding on sources that honour the abort signal',
        ),
        gateContext: z.object({
          userJurisdiction: z.string().optional().describe('caller\'s jurisdiction; a mismatch with a source-declared one defaults to needs-review'),
        }).optional().describe('context for the `gateFor` gate, matching the evaluate_use tool\'s jurisdiction inputs'),
        intent: z.enum(INTENTS).optional().describe('annotate each result with a use-verdict for this intended use (no filtering)'),
        gateFor: z.enum(INTENTS).optional().describe('only return results whose license allows this intended use'),
      },
      outputSchema: {
        references: z.array(agentRefSchema),
        nextCursor: z.string().optional().describe('pass back as `cursor` for the next batch; absent = exhausted'),
        meta: searchMetaSchema.optional(),
      },
    },
    async ({ query, modalities, controls, sourceOptions, explain, limit, cursor, rerank, minRelevance, deadlineMs, gateContext, intent, gateFor, sources }) => {
      // Typed as core's SearchInput so every parameter above is checked against
      // the contract it is forwarded into, not just against zod.
      const searchInput: SearchInput = {
        query,
        modalities: modalities ?? ['image'],
        sources,
        controls: controls as SearchControls | undefined,
        sourceOptions: sourceOptions as SourceOptionsById | undefined,
        limit,
        cursor,
        // Core reranks by default; only an explicit false turns it off.
        ...(rerank === false ? { rerank: false as const } : {}),
        minRelevance,
        deadlineMs,
        gateFor,
        gateContext,
      }
      // Always searchWithMeta: the continuation token (meta.nextCursor) must not
      // depend on the explain diagnostics flag — only the meta DUMP is gated.
      let result
      try {
        result = await refkit.searchWithMeta(searchInput)
      } catch (err) {
        // A source-selection miss (the requested ids resolve to no configured
        // source for the modality or kind) is a caller mistake, not an outage —
        // turn core's typed throw into an agent-actionable tool error listing the
        // valid ids. Recognised structurally, so a client built with another copy
        // of @refkit/core still gets the hint. Everything else (every source
        // failing, an invalid cursor, a search no source supports) propagates as
        // it is.
        if (isSourceSelectionError(err) && err.code === 'no-matching-source') {
          const available = enabledSourceIds.join(', ') || '(none)'
          return {
            isError: true,
            content: [{ type: 'text', text: `${err.message} Enabled source ids: ${available}.` }],
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
