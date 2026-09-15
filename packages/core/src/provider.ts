import type { Modality } from './modality'
import type { EmittedReference } from './reference'
// The control vocabulary (SearchControls and friends) lives in controls.ts —
// one registry, one definition; provider.ts only consumes it.
import type { ResourceKind, SearchControlKey, SearchControls } from './controls'

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
  search(query: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]>
}

/** Identity helper for type inference when authoring a provider factory. */
export function defineProvider(p: ReferenceProvider): ReferenceProvider {
  return p
}
