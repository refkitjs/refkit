import type { Modality } from './modality'
import type { Reference } from './reference'

export type QueryFeature =
  | 'keyword'
  | 'color'
  | 'orientation'
  | 'license-filter'
  | 'author'
  | 'language'

export type SearchSort = 'relevance' | 'latest' | 'popular' | 'interesting'
export type SearchSafety = 'strict' | 'moderate' | 'off'

export interface SearchLicenseControls {
  commercial?: boolean
  modification?: boolean
  allowUnknown?: boolean
}

export interface SearchMediaControls {
  kind?: 'photo' | 'illustration' | 'vector' | 'film' | 'animation'
  size?: 'small' | 'medium' | 'large'
  minWidth?: number
  minHeight?: number
  duration?: 'short' | 'medium' | 'long'
}

export interface SearchCreatorControls {
  id?: string
  name?: string
}

export interface SearchTextControls {
  copyright?: 'public-domain' | 'copyrighted' | 'any'
}

export interface SearchControls {
  orientation?: 'landscape' | 'portrait' | 'square'
  color?: string
  language?: string
  sort?: SearchSort
  safety?: SearchSafety
  license?: SearchLicenseControls
  media?: SearchMediaControls
  creator?: SearchCreatorControls
  text?: SearchTextControls
  page?: number
}

export type SearchControlKey =
  | 'orientation'
  | 'color'
  | 'language'
  | 'sort'
  | 'safety'
  | 'license.commercial'
  | 'license.modification'
  | 'license.allowUnknown'
  | 'media.kind'
  | 'media.size'
  | 'media.minWidth'
  | 'media.minHeight'
  | 'media.duration'
  | 'creator.id'
  | 'creator.name'
  | 'text.copyright'
  | 'page'

export interface ProviderCapabilities {
  controls: readonly SearchControlKey[]
}

export interface SearchFilters {
  color?: string
  orientation?: 'landscape' | 'portrait' | 'square'
  language?: string
}

export type ProviderOptionValue = string | number | boolean | readonly string[] | undefined
export type ProviderOptions = Record<string, ProviderOptionValue>
export type ProviderOptionsById = Record<string, ProviderOptions | undefined>

export interface NormalizedQuery {
  text: string
  modalities: Modality[]
  filters?: SearchFilters
  controls?: SearchControls
  providerOptions?: ProviderOptions
  limit?: number
}

/** Implementations SHOULD honor ttlMs — refkit's cached-result freshness is
 *  bounded by the TTL only when the cache enforces it. */
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
  capabilities?: ProviderCapabilities
  search(query: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]>
}

/** Identity helper for type inference when authoring a provider factory. */
export function defineProvider(p: ReferenceProvider): ReferenceProvider {
  return p
}
