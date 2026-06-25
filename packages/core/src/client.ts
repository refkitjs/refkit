import type { Reference } from './reference'
import { parseReference } from './reference'
import type { Reranker } from './rerank'
import type { Modality } from './modality'
import type { Intent, Verdict } from './evaluate-use'
import { evaluateUse } from './evaluate-use'
import type { Attribution } from './attribution'
import { buildAttribution } from './attribution'
import type { ReferenceProvider, ProviderContext, KeyValueCache, SearchFilters, ProviderOptionsById } from './provider'
import { mergeReferences, type MergeOptions } from './merge'
import { normalizeQuery } from './query'

export interface RefkitOptions {
  providers: ReferenceProvider[]
  fetch?: typeof fetch // optional; defaults to globalThis.fetch
  cache?: KeyValueCache
  signal?: AbortSignal
  merge?: MergeOptions
}

export interface ProviderError {
  providerId: string
  error: unknown
}

export interface ProviderSearchStatus {
  providerId: string
  status: 'fulfilled' | 'failed' | 'skipped'
  returned?: number
  accepted?: number
  rejected?: number
  reason?: 'unsupported-modality'
  error?: string
}

export interface SearchGateMeta {
  intent: Intent
  before: number
  after: number
  dropped: number
}

export interface SearchMeta {
  query: string
  modalities: Modality[]
  limit: number
  poolFactor: number
  fetchLimit: number
  appliedFilters?: SearchFilters
  providerOptions?: string[]
  providers: ProviderSearchStatus[]
  gate?: SearchGateMeta
  warnings: string[]
}

export interface SearchResult {
  references: Reference[]
  meta: SearchMeta
}

export interface SearchInput {
  query: string
  modalities: Modality[]
  filters?: SearchFilters
  /** Provider-specific search controls keyed by provider id. Core routes only the
   * matching entry to each provider; providers whitelist what they translate. */
  providerOptions?: ProviderOptionsById
  limit?: number
  /** Overfetch this many × `limit` candidates per provider before merge/rerank/gate,
   *  then narrow to `limit` — a wider pool means better dedup + ranking. Default 4
   *  (capped so a source is never asked for more than {@link MAX_POOL_LIMIT}); min 1.
   *  Total fan-out is providers × fetchLimit — lower this when querying many providers
   *  or when a source is rate-limited. */
  poolFactor?: number
  signal?: AbortSignal
  gateFor?: Intent
  onProviderError?: (e: ProviderError) => void
  rerank?: Reranker
}

export interface RefkitClient {
  search(input: SearchInput): Promise<Reference[]>
  searchWithMeta(input: SearchInput): Promise<SearchResult>
  evaluateUse(ref: Reference, intent: Intent, ctx?: { userJurisdiction?: string }): Verdict
  buildAttribution(ref: Reference): Attribution
  readonly providers: readonly ReferenceProvider[]
}

const DEFAULT_LIMIT = 30
const DEFAULT_POOL_FACTOR = 4
const MAX_POOL_LIMIT = 100 // never ask a single source for more than this, even at high limits

function errorSummary(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

export function createRefkit(options: RefkitOptions): RefkitClient {
  if (!options.providers || options.providers.length === 0) {
    throw new Error('createRefkit: at least one provider is required')
  }

  async function searchInternal(input: SearchInput): Promise<SearchResult> {
    const doFetch = options.fetch ?? globalThis.fetch
    if (typeof doFetch !== 'function') {
      throw new Error('createRefkit: no fetch available — pass options.fetch')
    }
    const ctx: ProviderContext = {
      fetch: doFetch,
      cache: options.cache,
      signal: input.signal ?? options.signal,
    }

    const chosen = options.providers.filter(p => p.modalities.some(m => input.modalities.includes(m)))
    if (chosen.length === 0) {
      throw new Error(`refkit.search: no registered provider supports modalities [${input.modalities.join(', ')}]`)
    }
    const limit = input.limit ?? DEFAULT_LIMIT
    const poolFactor = Math.max(1, Number.isFinite(input.poolFactor) ? (input.poolFactor as number) : DEFAULT_POOL_FACTOR)
    // Overfetch a wider candidate pool per provider, then narrow to `limit` after
    // merge/rerank/gate — you can't rank or dedup candidates you never fetched.
    const fetchLimit = Math.max(limit, Math.min(Math.ceil(limit * poolFactor), MAX_POOL_LIMIT))
    const statusByProvider = new Map<string, ProviderSearchStatus>()
    for (const p of options.providers) {
      if (!chosen.includes(p)) statusByProvider.set(p.id, { providerId: p.id, status: 'skipped', reason: 'unsupported-modality' })
    }
    const settled = await Promise.allSettled(
      chosen.map(p =>
        p.search(
          normalizeQuery({
            query: input.query,
            modalities: input.modalities,
            filters: input.filters,
            providerOptions: input.providerOptions,
            limit: fetchLimit,
          }, p),
          ctx,
        ),
      ),
    )

    const perSource: Reference[][] = []
    let anyOk = false
    settled.forEach((res, i) => {
      const provider = chosen[i]
      if (res.status === 'fulfilled') {
        anyOk = true
        const valid: Reference[] = []
        for (const raw of res.value) {
          try {
            valid.push(parseReference(raw))
          } catch (error) {
            input.onProviderError?.({ providerId: provider.id, error })
          }
        }
        statusByProvider.set(provider.id, {
          providerId: provider.id,
          status: 'fulfilled',
          returned: res.value.length,
          accepted: valid.length,
          rejected: res.value.length - valid.length,
        })
        perSource.push(valid)
      } else {
        input.onProviderError?.({ providerId: provider.id, error: res.reason })
        statusByProvider.set(provider.id, { providerId: provider.id, status: 'failed', error: errorSummary(res.reason) })
      }
    })

    if (!anyOk) {
      const reasons = settled
        .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
        .map(s => s.reason)
      throw new AggregateError(reasons, 'refkit.search: all providers failed')
    }

    let refs = mergeReferences(perSource, options.merge)
    // Rerank runs over the FULL merged pool, before the license gate — ordering
    // (and a reranker's batch-relative scoring, e.g. quality normalised across
    // the pool) is computed against every candidate, then the gate drops denied
    // ones while preserving order. Core does not re-validate the returned refs;
    // a reranker is trusted to honour the Reranker contract.
    if (input.rerank) {
      refs = await input.rerank({ query: input.query, refs, signal: input.signal ?? options.signal })
    }
    const beforeGate = refs.length
    let gate: SearchGateMeta | undefined
    if (input.gateFor) {
      const intent = input.gateFor
      refs = refs.filter(r => evaluateUse(r.rights, intent).decision.startsWith('allowed'))
      gate = { intent, before: beforeGate, after: refs.length, dropped: beforeGate - refs.length }
    }
    const references = refs.slice(0, limit)
    const warnings: string[] = []
    const failedCount = [...statusByProvider.values()].filter(s => s.status === 'failed').length
    if (failedCount > 0) warnings.push(`${failedCount} provider(s) failed; returning partial results.`)
    if (gate && gate.dropped > 0) warnings.push(`${gate.dropped} result(s) dropped by ${gate.intent} gate.`)
    return {
      references,
      meta: {
        query: input.query,
        modalities: input.modalities,
        limit,
        poolFactor,
        fetchLimit,
        ...(input.filters ? { appliedFilters: input.filters } : {}),
        ...(input.providerOptions ? { providerOptions: Object.keys(input.providerOptions) } : {}),
        providers: options.providers.map(p => statusByProvider.get(p.id) ?? { providerId: p.id, status: 'skipped', reason: 'unsupported-modality' }),
        ...(gate ? { gate } : {}),
        warnings,
      },
    }
  }

  async function search(input: SearchInput): Promise<Reference[]> {
    return (await searchInternal(input)).references
  }

  return {
    search,
    searchWithMeta: searchInternal,
    evaluateUse: (ref, intent, ctx) => evaluateUse(ref.rights, intent, ctx),
    buildAttribution: ref =>
      buildAttribution({
        license: ref.rights.license,
        licenseVersion: ref.rights.licenseVersion,
        author: ref.rights.author,
        title: ref.title,
        canonicalUrl: ref.canonicalUrl,
      }),
    get providers() {
      return options.providers
    },
  }
}
