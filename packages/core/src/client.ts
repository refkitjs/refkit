import type { Reference } from './reference'
import type { Reranker } from './rerank'
import type { Modality } from './modality'
import type { Intent, Verdict } from './evaluate-use'
import { evaluateUse } from './evaluate-use'
import type { Attribution } from './attribution'
import { buildAttribution } from './attribution'
import type { ReferenceProvider, KeyValueCache, ProviderOptionsById } from './provider'
import type { SearchControlKey, SearchControls } from './controls'
import type { MergeOptions, RightsConflict } from './merge'
import { retryingFetch, withDefaultUserAgent, withTimeout } from './resilience'
import { cursorSeenKey, decodeCursor, encodeCursor } from './cursor'
import { selectProviders, type ProviderSkipReason } from './select'
import { runPass, type PassDeps, type PassOutcome } from './pipeline'

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
  /** User-Agent sent on provider fetches that don't set one themselves. Default
   *  'refkit-client/1'; false disables the injection entirely. */
  userAgent?: string | false
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
  /** Items the provider returned that failed schema validation; items dropped
   *  by the `limit` truncation are neither accepted nor rejected. */
  rejected?: number
  reason?: ProviderSkipReason
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
  /** Fan-out passes this call ran (>1 only when the cursor advanced pages). */
  passes: number
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
  /** Whole-search deadline in ms, composed with `signal`. Providers still in
   *  flight when it fires are reported as failed; the search returns everyone
   *  else. Bounds the WHOLE call, cursor page advances included — unlike
   *  `resilience.timeoutMs`, which bounds one provider search. */
  deadlineMs?: number
  gateFor?: Intent
  /** Context for the search-time gate (`gateFor`), matching evaluateUse's ctx. */
  gateContext?: { userJurisdiction?: string }
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
const DEFAULT_USER_AGENT = 'refkit-client/1'
// Cursor: how many further provider pages one load-more call may try when the
// current page's pool is fully consumed, before reporting an empty batch.
const MAX_CURSOR_ADVANCES = 3
// Cursor: default cap on remembered already-returned keys (most recent kept;
// see RefkitOptions.maxCursorSeen). Bounds cursor size (~5.4 chars/key packed);
// overflowing just risks re-showing very old results.
const DEFAULT_MAX_CURSOR_SEEN = 500

/** Cross-source rights conflict, as a caller-facing warning. A single license id
 *  means the sources agreed on the label and only their FACTS disagreed — saying
 *  "CC-BY vs CC-BY" there would read as a no-op. */
function rightsConflictWarning(c: RightsConflict): string {
  const tail = `resolved to ${c.resolvedLicense}.`
  return c.licenses.length === 1
    ? `cross-source rights conflict for ${c.canonicalUrl}: ${c.licenses[0]} declared with differing facts → ${tail}`
    : `cross-source license conflict for ${c.canonicalUrl}: ${c.licenses.join(' vs ')} → ${tail}`
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
    const selection = selectProviders(options.providers, {
      modalities: input.modalities,
      sources: input.sources,
      kind: input.controls?.media?.kind,
      text: input.query,
    })
    const limit = input.limit ?? DEFAULT_LIMIT
    const poolFactor = Math.max(1, Number.isFinite(input.poolFactor) ? (input.poolFactor as number) : DEFAULT_POOL_FACTOR)
    // Overfetch a wider candidate pool per provider, then narrow to `limit` after
    // merge/rerank/gate — you can't rank or dedup candidates you never fetched.
    const fetchLimit = Math.max(limit, Math.min(Math.ceil(limit * poolFactor), MAX_POOL_LIMIT))
    const cursorState = input.cursor !== undefined ? decodeCursor(input.cursor) : undefined
    const seen = cursorState ? new Set(cursorState.seen) : undefined
    const resilience = options.resilience === false ? undefined : {
      timeoutMs: options.resilience?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: options.resilience?.retries ?? DEFAULT_RETRIES,
    }
    // Built once per search (doFetch/retries are fixed for the whole call) and
    // shared across every provider in the fan-out below, instead of allocating
    // a fresh wrapper per provider.
    const withRetry = resilience && resilience.retries > 0 ? retryingFetch(doFetch, { retries: resilience.retries }) : doFetch
    const sharedFetch = options.userAgent === false
      ? withRetry
      : withDefaultUserAgent(withRetry, options.userAgent ?? DEFAULT_USER_AGENT)
    const parentSignal = input.signal ?? options.signal
    // The whole-search deadline is composed with the caller's signal once and
    // handed to every pass, so cursor page advances share one budget.
    const deadline = input.deadlineMs !== undefined ? withTimeout(parentSignal, input.deadlineMs) : undefined
    const signal = deadline?.signal ?? parentSignal
    const concurrency = options.concurrency !== undefined && options.concurrency >= 1
      ? Math.floor(options.concurrency)
      : undefined
    const deps: PassDeps = {
      providers: options.providers,
      chosen: selection.chosen,
      skipReasons: selection.skipReasons,
      query: input.query,
      modalities: input.modalities,
      controls: input.controls,
      providerOptions: input.providerOptions,
      fetchLimit,
      run: {
        fetch: sharedFetch,
        cache: options.cache,
        cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
        cacheRaw: options.cacheRaw ?? true,
        timeoutMs: resilience?.timeoutMs,
        signal,
      },
      concurrency,
      merge: options.merge,
      rerank: input.rerank,
      gateFor: input.gateFor,
      gateContext: input.gateContext,
      seen,
      signal,
      onProviderError: (providerId, error) => input.onProviderError?.({ providerId, error }),
    }
    try {
      // Providers fetch fetchLimit (≥ limit) candidates per page, but each call
      // returns only `limit` — so the cursor must NOT advance the provider page
      // per call, or the unreturned overfetch remainder would be skipped forever.
      // Instead nextCursor keeps pointing at the SAME page (the seen-filter makes
      // repeats free) and the page advances here, internally, only once a page's
      // pool yields nothing new — up to MAX_CURSOR_ADVANCES pages per call.
      let page = cursorState ? cursorState.page : input.controls?.page
      const passes: PassOutcome[] = [await runPass(deps, page)]
      if (cursorState) {
        const exhausted = () => {
          const last = passes[passes.length - 1]
          return last.refs.length === 0 && last.totalReturned > 0
        }
        for (let advances = 0; exhausted() && advances < MAX_CURSOR_ADVANCES; advances++) {
          page = (page ?? 1) + 1
          passes.push(await runPass(deps, page))
        }
      }
      // Diagnostics accumulate over every pass; the RESULT comes from the last
      // one (the only pass whose refs survived the seen-filter).
      const last = passes[passes.length - 1]
      const references = last.refs.slice(0, limit)
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
      if (selection.unknownSources.length > 0) warnings.push(`unknown source id(s) ignored: ${selection.unknownSources.join(', ')}.`)
      // Per-pass failure counts: a provider that failed on an earlier page and
      // recovered on a later one must still be visible.
      passes.forEach((pass, i) => {
        const failed = [...pass.statusByProvider.values()].filter(s => s.status === 'failed').length
        if (failed === 0) return
        warnings.push(passes.length > 1
          ? `pass ${i + 1}: ${failed} provider(s) failed; returning partial results.`
          : `${failed} provider(s) failed; returning partial results.`)
      })
      // Conflicts concatenate across passes but are reported once per URL — the
      // same URL conflicts again on every page that returns it.
      const reportedConflicts = new Set<string>()
      for (const pass of passes) {
        for (const c of pass.rightsConflicts) {
          if (reportedConflicts.has(c.canonicalUrl)) continue
          reportedConflicts.add(c.canonicalUrl)
          warnings.push(rightsConflictWarning(c))
        }
      }
      if (last.gate && last.gate.dropped > 0) warnings.push(`${last.gate.dropped} result(s) dropped by ${last.gate.intent} gate.`)
      // Status: the last pass wins (it produced the results), but latency sums
      // over every pass — a multi-pass call really did spend that long.
      const providers = options.providers.map((p): ProviderSearchStatus => {
        const status = last.statusByProvider.get(p.id)
          ?? { providerId: p.id, status: 'skipped' as const, reason: selection.skipReasons.get(p.id) ?? 'unsupported-modality' as const }
        if (status.status === 'skipped') return status
        return { ...status, latencyMs: passes.reduce((sum, pass) => sum + (pass.statusByProvider.get(p.id)?.latencyMs ?? 0), 0) }
      })
      return {
        references,
        meta: {
          query: input.query,
          modalities: input.modalities,
          limit,
          poolFactor,
          fetchLimit,
          passes: passes.length,
          ...(last.controlsMeta ? { controls: last.controlsMeta } : {}),
          ...(input.providerOptions ? { providerOptions: Object.keys(input.providerOptions) } : {}),
          providers,
          ...(last.gate ? { gate: last.gate } : {}),
          ...(nextCursor ? { nextCursor } : {}),
          warnings,
        },
      }
    } finally {
      deadline?.cancel()
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
        facts: ref.rights.facts,
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
