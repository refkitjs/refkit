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
import { runProviderSearch } from './provider-run'
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
  /** Max provider searches in flight at once per search call. Default: unlimited
   *  (every matching provider fires simultaneously). Set when querying many
   *  sources at once — a provider's timeout only starts when its slot starts, so
   *  queueing never burns a queued provider's deadline. */
  concurrency?: number
  /** Cap on already-returned keys remembered inside the load-more cursor (most
   *  recent kept). Each key costs ~5.4 chars of cursor, so this bounds
   *  `meta.nextCursor` length (~2.7k chars at the default 500). Lower it when
   *  the cursor travels a size-sensitive channel (e.g. LLM tool output);
   *  overflowing just risks re-showing results evicted long ago. `Infinity`
   *  disables the cap. Effective floor is the batch just returned — evicting
   *  keys the same call produced would repeat them immediately and load-more
   *  would never converge. */
  maxCursorSeen?: number
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
  reason?: 'unsupported-modality' | 'not-selected'
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
   *  batch with cross-page dedup handled internally. Present when this call
   *  returned at least one result; absent = the stream is exhausted. */
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
  /** Restrict this search to these provider ids (intersected with modality
   *  matching). Omit to fan out to every configured source. Lets the caller
   *  scope search-engine operators (e.g. `site:xiaohongshu.com`) to a
   *  web-discovery source without polluting other providers' queries.
   *
   *  A total miss — no requested id matches a configured provider for the
   *  requested modalities — throws (a source typo must fail loudly, not read as
   *  "no results"); ids that resolve to nothing while others still match are
   *  reported in `meta.warnings`. */
  sources?: string[]
  /** @deprecated Compatibility alias for `controls.color` / `controls.orientation`
   *  / `controls.language` (controls win on conflict). Use `controls`. */
  filters?: SearchFilters
  controls?: SearchControls
  /** Provider-specific search controls keyed by provider id. Core routes only the
   * matching entry to each provider; providers whitelist what they translate. */
  providerOptions?: ProviderOptionsById
  limit?: number
  /** Opaque cursor from a previous search's `meta.nextCursor`. Resumes the
   *  provider-local page (overriding `controls.page`), filters out results
   *  already returned on earlier calls, and advances the page automatically once
   *  the current page's pool is exhausted — "load more" needs no caller-side
   *  bookkeeping. Throws on a string that did not come from `meta.nextCursor`. */
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
// Cursor: how many further provider pages one load-more call may try when the
// current page's pool is fully consumed, before reporting an empty batch.
const MAX_CURSOR_ADVANCES = 3
// Cursor: default cap on remembered already-returned keys (most recent kept;
// see RefkitOptions.maxCursorSeen). Bounds cursor size (~5.4 chars/key packed);
// overflowing just risks re-showing very old results.
const DEFAULT_MAX_CURSOR_SEEN = 500

function errorSummary(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

// Bounded-parallel map: at most `limit` fn calls in flight, results in input
// order. fn never rejects here (runProvider returns failures as values).
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export function createRefkit(options: RefkitOptions): RefkitClient {
  // Array.isArray (not just truthiness): a Promise<providers[]> — e.g. an
  // un-awaited async factory — must fail here with a clear message, not pass
  // construction and crash cryptically on the first search.
  if (!Array.isArray(options.providers) || options.providers.length === 0) {
    throw new Error('createRefkit: providers must be a non-empty array (did you forget to await an async provider factory?)')
  }

  async function searchInternal(input: SearchInput): Promise<SearchResult> {
    const doFetch = options.fetch ?? globalThis.fetch
    if (typeof doFetch !== 'function') {
      throw new Error('createRefkit: no fetch available — pass options.fetch')
    }
    const matchesModality = (p: ReferenceProvider) => p.modalities.some(m => input.modalities.includes(m))
    const inSources = (p: ReferenceProvider) => input.sources == null || input.sources.includes(p.id)
    const chosen = options.providers.filter(p => inSources(p) && matchesModality(p))
    if (chosen.length === 0) {
      // A source-scoped miss is a caller typo, not "no results" — fail loudly in
      // the same spirit as the empty-providers guard, rather than silently
      // returning an empty set that hides the mistake.
      if (input.sources != null) {
        throw new Error(`refkit.search: no configured provider matches source id(s) [${input.sources.join(', ')}] for modalities [${input.modalities.join(', ')}]`)
      }
      throw new Error(`refkit.search: no registered provider supports modalities [${input.modalities.join(', ')}]`)
    }
    // Individual unknown ids (while others still resolved) are tolerated but
    // surfaced — routed into meta.warnings below, matching the soft-signal channel.
    const unknownSources = input.sources
      ? input.sources.filter(id => !options.providers.some(p => p.id === id))
      : []
    const limit = input.limit ?? DEFAULT_LIMIT
    const poolFactor = Math.max(1, Number.isFinite(input.poolFactor) ? (input.poolFactor as number) : DEFAULT_POOL_FACTOR)
    // Overfetch a wider candidate pool per provider, then narrow to `limit` after
    // merge/rerank/gate — you can't rank or dedup candidates you never fetched.
    const fetchLimit = Math.max(limit, Math.min(Math.ceil(limit * poolFactor), MAX_POOL_LIMIT))
    const cursorState = input.cursor !== undefined ? decodeCursor(input.cursor) : undefined
    const seenSet = cursorState ? new Set(cursorState.seen) : undefined
    const resilience = options.resilience === false ? undefined : {
      timeoutMs: options.resilience?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: options.resilience?.retries ?? DEFAULT_RETRIES,
    }
    // Built once per search (doFetch/retries are fixed for the whole call) and
    // shared across every provider in the fan-out below, instead of allocating
    // a fresh wrapper per provider.
    const sharedFetch = resilience && resilience.retries > 0 ? retryingFetch(doFetch, { retries: resilience.retries }) : doFetch
    const concurrency = options.concurrency !== undefined && options.concurrency >= 1
      ? Math.floor(options.concurrency)
      : undefined

    interface PassOutcome {
      refs: Reference[] // post merge/rerank/gate/seen-filter, best-first
      controlsMeta?: SearchControlsMeta
      statusByProvider: Map<string, ProviderSearchStatus>
      gate?: SearchGateMeta
      rightsConflicts: RightsConflict[]
      totalReturned: number // raw items across fulfilled providers (pre-parse)
    }

    // One full fan-out → merge → rerank → gate → seen-filter pass at the given
    // provider-local page. The cursor path may run several passes per call.
    const runPass = async (page: number | undefined): Promise<PassOutcome> => {
      const controls = page !== undefined ? { ...input.controls, page } : input.controls
      const requestedControlsSource = mergeSearchControls(controls, input.filters)
      const requestedControls = requestedControlKeys(requestedControlsSource)
      const controlsMeta = requestedControls.length > 0 ? {
        requested: requestedControls,
        appliedByProvider: Object.fromEntries(options.providers.map(p => [p.id, supportedControlKeys(p, requestedControlsSource)])),
        ignoredByProvider: Object.fromEntries(options.providers.map(p => [p.id, unsupportedControlKeys(p, requestedControlsSource)])),
      } : undefined
      const statusByProvider = new Map<string, ProviderSearchStatus>()
      for (const p of options.providers) {
        if (chosen.includes(p)) continue
        // Distinguish a wrong-modality skip from one caused by an explicit sources
        // filter, so meta explains WHY a provider sat this search out.
        const reason = matchesModality(p) ? 'not-selected' : 'unsupported-modality'
        statusByProvider.set(p.id, { providerId: p.id, status: 'skipped', reason })
      }

      const runProvider = (p: ReferenceProvider) => {
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

      const runs = concurrency
        ? await mapBounded(chosen, concurrency, runProvider)
        : await Promise.all(chosen.map(runProvider))

      const perSource: Reference[][] = []
      let anyOk = false
      let totalReturned = 0
      runs.forEach((run, i) => {
        const provider = chosen[i]
        if (run.ok) {
          anyOk = true
          totalReturned += run.returned
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
      // Cursor pagination: drop results already returned on earlier calls (RRF
      // pages overlap by design), AFTER rank/gate so ordering is batch-consistent
      // but BEFORE the limit so repeats don't consume the batch budget.
      if (seenSet) {
        refs = refs.filter(r => !seenSet.has(cursorSeenKey(r.canonicalUrl)))
      }
      return { refs, controlsMeta, statusByProvider, gate, rightsConflicts, totalReturned }
    }

    // Providers fetch fetchLimit (≥ limit) candidates per page, but each call
    // returns only `limit` — so the cursor must NOT advance the provider page
    // per call, or the unreturned overfetch remainder would be skipped forever.
    // Instead nextCursor keeps pointing at the SAME page (the seen-filter makes
    // repeats free) and the page advances here, internally, only once a page's
    // pool yields nothing new — up to MAX_CURSOR_ADVANCES pages per call.
    let page = cursorState ? cursorState.page : input.controls?.page
    let pass = await runPass(page)
    if (cursorState) {
      for (
        let advances = 0;
        pass.refs.length === 0 && pass.totalReturned > 0 && advances < MAX_CURSOR_ADVANCES;
        advances++
      ) {
        page = (page ?? 1) + 1
        pass = await runPass(page)
      }
    }

    const references = pass.refs.slice(0, limit)
    // Never below this batch's size (evicting keys just returned would repeat
    // them on the very next call); Infinity = uncapped, NaN falls back.
    const rawMaxSeen = options.maxCursorSeen ?? DEFAULT_MAX_CURSOR_SEEN
    const maxCursorSeen = Math.max(Number.isNaN(rawMaxSeen) ? DEFAULT_MAX_CURSOR_SEEN : rawMaxSeen, references.length)
    const nextCursor = references.length > 0
      ? encodeCursor({
          // Same page on purpose — its overfetched pool may still hold
          // unreturned results; the next call advances internally if not.
          page: page ?? 1,
          seen: [...(cursorState?.seen ?? []), ...references.map(r => cursorSeenKey(r.canonicalUrl))].slice(-maxCursorSeen),
        })
      : undefined
    const warnings: string[] = []
    if (unknownSources.length > 0) warnings.push(`unknown source id(s) ignored: ${unknownSources.join(', ')}.`)
    const failedCount = [...pass.statusByProvider.values()].filter(s => s.status === 'failed').length
    if (failedCount > 0) warnings.push(`${failedCount} provider(s) failed; returning partial results.`)
    for (const c of pass.rightsConflicts) {
      warnings.push(`cross-source license conflict for ${c.canonicalUrl}: ${c.licenses.join(' vs ')} → resolved to ${c.resolvedLicense}.`)
    }
    if (pass.gate && pass.gate.dropped > 0) warnings.push(`${pass.gate.dropped} result(s) dropped by ${pass.gate.intent} gate.`)
    return {
      references,
      meta: {
        query: input.query,
        modalities: input.modalities,
        limit,
        poolFactor,
        fetchLimit,
        ...(input.filters ? { appliedFilters: input.filters } : {}),
        ...(pass.controlsMeta ? { controls: pass.controlsMeta } : {}),
        ...(input.providerOptions ? { providerOptions: Object.keys(input.providerOptions) } : {}),
        providers: options.providers.map(p => pass.statusByProvider.get(p.id) ?? { providerId: p.id, status: 'skipped', reason: 'unsupported-modality' }),
        ...(pass.gate ? { gate: pass.gate } : {}),
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
