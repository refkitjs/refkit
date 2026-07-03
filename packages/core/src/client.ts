import type { Reference } from './reference'
import { parseReference } from './reference'
import type { Reranker } from './rerank'
import type { Modality } from './modality'
import type { Intent, Verdict } from './evaluate-use'
import { evaluateUse } from './evaluate-use'
import type { Attribution } from './attribution'
import { buildAttribution } from './attribution'
import type {
  ReferenceProvider,
  ProviderContext,
  KeyValueCache,
  SearchFilters,
  SearchControls,
  SearchControlKey,
  ProviderOptionsById,
} from './provider'
import { mergeReferences, type MergeOptions } from './merge'
import { mergeSearchControls, normalizeQuery, requestedControlKeys, supportedControlKeys, unsupportedControlKeys } from './query'
import { retryingFetch, withTimeout } from './resilience'
import { fnv1a } from './hash'

export interface ResilienceOptions {
  /** Soft deadline per provider search. Default 10_000. */
  timeoutMs?: number
  /** Extra fetch attempts on 429/5xx/network-error. Default 1. */
  retries?: number
}

export interface RefkitOptions {
  providers: ReferenceProvider[]
  fetch?: typeof fetch // optional; defaults to globalThis.fetch
  cache?: KeyValueCache
  signal?: AbortSignal
  merge?: MergeOptions
  /** Per-provider timeout + retry (H8). Defaults ON; pass `false` to disable both. */
  resilience?: ResilienceOptions | false
  /** TTL for per-provider cached results; used only when `cache` is set. Default 300_000. */
  cacheTtlMs?: number
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
  latencyMs?: number
  cached?: boolean
}

export interface SearchGateMeta {
  intent: Intent
  before: number
  after: number
  dropped: number
}

export interface SearchControlsMeta {
  requested: SearchControlKey[]
  appliedByProvider: Record<string, SearchControlKey[]>
  ignoredByProvider: Record<string, SearchControlKey[]>
}

export interface SearchMeta {
  query: string
  modalities: Modality[]
  limit: number
  poolFactor: number
  fetchLimit: number
  appliedFilters?: SearchFilters
  controls?: SearchControlsMeta
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
  controls?: SearchControls
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
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRIES = 1
const DEFAULT_CACHE_TTL_MS = 300_000

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
    const chosen = options.providers.filter(p => p.modalities.some(m => input.modalities.includes(m)))
    if (chosen.length === 0) {
      throw new Error(`refkit.search: no registered provider supports modalities [${input.modalities.join(', ')}]`)
    }
    const limit = input.limit ?? DEFAULT_LIMIT
    const poolFactor = Math.max(1, Number.isFinite(input.poolFactor) ? (input.poolFactor as number) : DEFAULT_POOL_FACTOR)
    // Overfetch a wider candidate pool per provider, then narrow to `limit` after
    // merge/rerank/gate — you can't rank or dedup candidates you never fetched.
    const fetchLimit = Math.max(limit, Math.min(Math.ceil(limit * poolFactor), MAX_POOL_LIMIT))
    const requestedControlsSource = mergeSearchControls(input.controls, input.filters)
    const requestedControls = requestedControlKeys(requestedControlsSource)
    const controlsMeta = requestedControls.length > 0 ? {
      requested: requestedControls,
      appliedByProvider: Object.fromEntries(options.providers.map(p => [p.id, supportedControlKeys(p, requestedControlsSource)])),
      ignoredByProvider: Object.fromEntries(options.providers.map(p => [p.id, unsupportedControlKeys(p, requestedControlsSource)])),
    } : undefined
    const statusByProvider = new Map<string, ProviderSearchStatus>()
    for (const p of options.providers) {
      if (!chosen.includes(p)) statusByProvider.set(p.id, { providerId: p.id, status: 'skipped', reason: 'unsupported-modality' })
    }
    const resilience = options.resilience === false ? undefined : {
      timeoutMs: options.resilience?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: options.resilience?.retries ?? DEFAULT_RETRIES,
    }

    type ProviderRun =
      | { ok: true; valid: Reference[]; returned: number; latencyMs: number; cached?: boolean }
      | { ok: false; error: unknown; latencyMs: number }

    const runProvider = async (p: ReferenceProvider): Promise<ProviderRun> => {
      const started = Date.now()
      const timeout = resilience ? withTimeout(input.signal ?? options.signal, resilience.timeoutMs) : undefined
      const ctx: ProviderContext = {
        fetch: resilience && resilience.retries > 0 ? retryingFetch(doFetch, { retries: resilience.retries }) : doFetch,
        cache: options.cache,
        signal: timeout?.signal ?? input.signal ?? options.signal,
      }
      const query = normalizeQuery({
        query: input.query,
        modalities: input.modalities,
        filters: input.filters,
        controls: input.controls,
        providerOptions: input.providerOptions,
        limit: fetchLimit,
      }, p)
      const cacheKey = options.cache
        ? `refkit:v1:${p.id}:${fnv1a(JSON.stringify(query))}`
        : undefined
      if (options.cache && cacheKey) {
        // best-effort: a broken/corrupt/stale cache degrades to a live search
        const hit = await options.cache.get(cacheKey).catch(() => undefined)
        if (hit !== undefined) {
          try {
            // cached refs keep their original verifiedAt — staleness is bounded by the TTL
            const parsed = (JSON.parse(hit) as unknown[]).map(item => parseReference(item))
            return { ok: true, valid: parsed, returned: parsed.length, latencyMs: Date.now() - started, cached: true }
          } catch { /* fall through to live */ }
        }
      }
      try {
        const searching = p.search(query, ctx)
        searching.catch(() => {}) // a raced-past provider must not become an unhandled rejection
        const raw = await (timeout ? Promise.race([searching, timeout.expired]) : searching)
        const valid: Reference[] = []
        for (const item of raw) {
          try {
            valid.push(parseReference(item))
          } catch (error) {
            input.onProviderError?.({ providerId: p.id, error })
          }
        }
        if (options.cache && cacheKey) {
          // fire-and-forget: cache write failure must never fail the search
          void options.cache.set(cacheKey, JSON.stringify(valid), options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS).catch(() => {})
        }
        return { ok: true, valid, returned: raw.length, latencyMs: Date.now() - started }
      } catch (error) {
        input.onProviderError?.({ providerId: p.id, error })
        return { ok: false, error, latencyMs: Date.now() - started }
      } finally {
        timeout?.cancel()
      }
    }

    const runs = await Promise.all(chosen.map(runProvider))

    const perSource: Reference[][] = []
    let anyOk = false
    runs.forEach((run, i) => {
      const provider = chosen[i]
      if (run.ok) {
        anyOk = true
        statusByProvider.set(provider.id, {
          providerId: provider.id,
          status: 'fulfilled',
          returned: run.returned,
          accepted: run.valid.length,
          rejected: run.returned - run.valid.length,
          latencyMs: run.latencyMs,
          ...(run.cached ? { cached: true } : {}),
        })
        perSource.push(run.valid)
      } else {
        statusByProvider.set(provider.id, { providerId: provider.id, status: 'failed', error: errorSummary(run.error), latencyMs: run.latencyMs })
      }
    })

    if (!anyOk) {
      throw new AggregateError(runs.filter(r => !r.ok).map(r => (r as { error: unknown }).error), 'refkit.search: all providers failed')
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
        ...(controlsMeta ? { controls: controlsMeta } : {}),
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
