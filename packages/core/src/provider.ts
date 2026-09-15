import type { Modality } from './modality'
import type { Reference } from './reference'

export type SearchSort = 'relevance' | 'latest' | 'popular' | 'interesting'
export type SearchSafety = 'strict' | 'moderate' | 'off'

/** Fine-grained resource kind. Open vocabulary: well-known values get
 *  autocomplete; any other string is a valid custom kind. Well-known values are
 *  hints, not validation — core never rejects unknown kinds. */
export type WellKnownKind =
  | 'photo' | 'illustration' | 'vector' | 'icon' | 'artwork'
  | 'texture' | 'hdri' | '3d-model'
  | 'film' | 'animation'
  | 'music' | 'sound-effect'
  | 'ebook' | 'poem'
export type ResourceKind = WellKnownKind | (string & {})

export interface SearchLicenseControls {
  commercial?: boolean
  modification?: boolean
  allowUnknown?: boolean
}

export interface SearchMediaControls {
  kind?: ResourceKind
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
  /** Provider-local page cursor: each provider paginates its own result stream;
   *  after RRF merging, page N+1 may overlap or shift relative to page N. For
   *  UI "load more", dedupe across pages by canonicalUrl (see README). */
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

export type ProviderOptionValue = string | number | boolean | readonly string[] | undefined
export type ProviderOptions = Record<string, ProviderOptionValue>
export type ProviderOptionsById = Record<string, ProviderOptions | undefined>

export interface NormalizedQuery {
  text: string
  modalities: Modality[]
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
  /** Forward into fetch init.signal — it carries the orchestrator's per-provider
   *  deadline; forwarding enables timeout cancellation and prevents burning a
   *  retry on an aborted request. */
  signal?: AbortSignal
}

// 3 load-bearing fields. Keys are held by the provider's factory closure
// (e.g. `unsplash({ accessKey })`), not declared here; rate-limit metadata is added
// in P1 when the orchestrator implements throttling.
export interface ReferenceProvider {
  id: string
  modalities: Modality[]
  /** Fine-grained kinds this provider offers (routing: a kind-filtered search
   *  skips providers whose declared kinds lack the requested value; undeclared
   *  providers are conservatively included). Orthogonal to the `media.kind`
   *  entry in capabilities.controls, which declares upstream FILTER support. */
  kinds?: readonly ResourceKind[]
  /** One-line content-domain summary, surfaced in the MCP tool's source list
   *  so an agent can judge topical fit (e.g. "CC0 PBR textures for 3D work"). */
  description?: string
  capabilities?: ProviderCapabilities
  search(query: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]>
}

/** Identity helper for type inference when authoring a provider factory. */
export function defineProvider(p: ReferenceProvider): ReferenceProvider {
  return p
}
