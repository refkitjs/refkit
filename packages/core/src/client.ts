import type { Reference } from './reference'
import type { Reranker } from './rerank'
import type { Modality } from './modality'
import type { Intent, Verdict } from './evaluate-use'
import { evaluateUse } from './evaluate-use'
import type { Attribution } from './attribution'
import { buildAttribution } from './attribution'
import type {
  ReferenceProvider,
  KeyValueCache,
  SearchFilters,
  SearchControls,
  SearchControlKey,
  ProviderOptionsById,
} from './provider'
import { mergeReferences, type MergeOptions, type RightsConflict } from './merge'
import { mergeSearchControls, normalizeQuery, requestedControlKeys, supportedControlKeys, unsupportedControlKeys } from './query'
import { retryingFetch } from './resilience'
import { runProviderSearch, type ProviderRun } from './provider-run'
import { cursorSeenKey, decodeCursor, encodeCursor } from './cursor'

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
  /** Include each result's `raw` provider payload in cached entries. Default true.
   *  Pass false to shrink cache entries — cache-hit refs then carry no `raw`, so a
   *  `merge.isDuplicate` hook reading `raw` won't see it on hits. */
  cacheRaw?: boolean
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
  /** Opaque "load more" cursor: pass as `SearchInput.cursor` to fetch the next
   *  page with cross-page dedup handled internally. Present when this page
   *  returned at least one result. */
  nextCursor?: string
  warnings: string[]
}

export interface SearchResult {
  references: Reference[]
  meta: SearchMeta
}

export interface SearchInput {
  query: string
  modalities: Modality[]
  /** @deprecated Compatibility alias for `controls.color` / `controls.orientation`
   *  / `controls.language` (controls win on conflict). Use `controls`. */
  filters?: SearchFilters
  controls?: SearchControls
  /** Provider-specific search controls keyed by provider id. Core routes only the
   * matching entry to each provider; providers whitelist what they translate. */
  providerOptions?: ProviderOptionsById
  limit?: number
  /** Opaque cursor from a previous search's `meta.nextCursor`. Sets the
   *  provider-local page (overriding `controls.page`) and filters out results
   *  already returned on earlier pages, so "load more" needs no caller-side
   *  dedup. Throws on a string that did not come from `meta.nextCursor`. */
  cursor?: string
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
    // A cursor overrides controls.page and carries the already-seen set; the
    // effective controls are what routing, providers, and meta all see.
    const cursorState = input.cursor !== undefined ? decodeCursor(input.cursor) : undefined
    const controls = cursorState ? { ...input.controls, page: cursorState.page } : input.controls
    const requestedControlsSource = mergeSearchControls(controls, input.filters)
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
    // Built once per search (doFetch/retries are fixed for the whole call) and
    // shared across every provider in the fan-out below, instead of allocating
    // a fresh wrapper per provider.
    const sharedFetch = resilience && resilience.retries > 0 ? retryingFetch(doFetch, { retries: resilience.retries }) : doFetch

    const runProvider = (p: ReferenceProvider): Promise<ProviderRun> => {
      const query = normalizeQuery({
        query: input.query,
        modalities: input.modalities,
        filters: input.filters,
        controls,
        providerOptions: input.providerOptions,
        limit: fetchLimit,
      }, p)
      return runProviderSearch(p, query, {
        fetch: sharedFetch,
        cache: options.cache,
        cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
        cacheRaw: options.cacheRaw ?? true,
        timeoutMs: resilience?.timeoutMs,
        signal: input.signal ?? options.signal,
        onError: (error) => input.onProviderError?.({ providerId: p.id, error }),
      })
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

    // Collect cross-source license conflicts for meta.warnings while still
    // forwarding them to a host-supplied observer.
    const rightsConflicts: RightsConflict[] = []
    let refs = mergeReferences(perSource, {
      ...options.merge,
      onRightsConflict: (c) => {
        rightsConflicts.push(c)
        options.merge?.onRightsConflict?.(c)
      },
    })
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
    // Cursor pagination: drop results already returned on earlier pages (RRF
    // pages overlap by design), AFTER rank/gate so ordering is batch-consistent
    // but BEFORE the limit so repeats don't consume the page budget.
    if (cursorState) {
      const seen = new Set(cursorState.seen)
      refs = refs.filter(r => !seen.has(cursorSeenKey(r.canonicalUrl)))
    }
    const references = refs.slice(0, limit)
    const nextCursor = references.length > 0
      ? encodeCursor({
          v: 1,
          page: (controls?.page ?? 1) + 1,
          seen: [...(cursorState?.seen ?? []), ...references.map(r => cursorSeenKey(r.canonicalUrl))],
        })
      : undefined
    const warnings: string[] = []
    const failedCount = [...statusByProvider.values()].filter(s => s.status === 'failed').length
    if (failedCount > 0) warnings.push(`${failedCount} provider(s) failed; returning partial results.`)
    for (const c of rightsConflicts) {
      warnings.push(`cross-source license conflict for ${c.canonicalUrl}: ${c.licenses.join(' vs ')} → resolved to ${c.resolvedLicense}.`)
    }
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
        ...(nextCursor ? { nextCursor } : {}),
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
