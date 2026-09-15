import { z } from 'zod'
import { MODALITIES } from './modality'
import { SEARCH_CONTROL_KEYS } from './controls'
import { INTENTS } from './evaluate-use'
import { PROVIDER_SKIP_REASONS, type ProviderSearchStatus, type SearchMeta } from './client'

// Runtime validation for the search-result metadata core produces, derived from
// the same registries the orchestrator routes on — hosts (e.g. the MCP server's
// tool outputSchema) describe `meta` without re-typing any vocabulary.
export const searchControlKeySchema = z.enum(SEARCH_CONTROL_KEYS as [string, ...string[]])

export const providerSearchStatusSchema: z.ZodType<ProviderSearchStatus> = z.object({
  providerId: z.string(),
  status: z.enum(['fulfilled', 'failed', 'skipped']),
  returned: z.number().optional(),
  accepted: z.number().optional(),
  rejected: z.number().optional(),
  reason: z.enum(PROVIDER_SKIP_REASONS).optional(),
  error: z.string().optional(),
  latencyMs: z.number().optional(),
  cached: z.boolean().optional(),
})

export const searchMetaSchema: z.ZodType<SearchMeta> = z.object({
  query: z.string(),
  modalities: z.array(z.enum(MODALITIES)),
  limit: z.number(),
  poolFactor: z.number(),
  fetchLimit: z.number(),
  controls: z.object({
    requested: z.array(searchControlKeySchema),
    appliedByProvider: z.record(z.string(), z.array(searchControlKeySchema)),
    ignoredByProvider: z.record(z.string(), z.array(searchControlKeySchema)),
  }).optional(),
  providerOptions: z.array(z.string()).optional(),
  providers: z.array(providerSearchStatusSchema),
  gate: z.object({ intent: z.enum(INTENTS), before: z.number(), after: z.number(), dropped: z.number() }).optional(),
  nextCursor: z.string().optional().describe('opaque load-more cursor; pass back as `cursor` to fetch the next page with cross-page dedup'),
  warnings: z.array(z.string()),
}) as z.ZodType<SearchMeta>
