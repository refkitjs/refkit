import type { Modality } from './modality'
import type { Reference } from './reference'

export type QueryFeature =
  | 'keyword'
  | 'color'
  | 'orientation'
  | 'license-filter'
  | 'author'
  | 'language'

export interface SearchFilters {
  color?: string
  orientation?: 'landscape' | 'portrait' | 'square'
  language?: string
}

export interface NormalizedQuery {
  text: string
  modalities: Modality[]
  filters?: SearchFilters
  limit?: number
}

export interface KeyValueCache {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string, ttlMs?: number): Promise<void>
}

// Injected by the host/client. core defines the port; providers call `ctx.fetch`.
// core itself never references a global fetch nor hard-codes an endpoint (zero-network).
export interface ProviderContext {
  fetch: typeof fetch
  cache?: KeyValueCache
  signal?: AbortSignal
}

// 4 load-bearing fields. Keys are held by the provider's factory closure
// (e.g. `unsplash({ accessKey })`), not declared here; rate-limit metadata is added
// in P1 when the orchestrator implements throttling.
export interface ReferenceProvider {
  id: string
  modalities: Modality[]
  queryFeatures: QueryFeature[]
  search(query: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]>
}

/** Identity helper for type inference when authoring a provider factory. */
export function defineProvider(p: ReferenceProvider): ReferenceProvider {
  return p
}
