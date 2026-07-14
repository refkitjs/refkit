// One provider's slice of a search fan-out: cache read → live search → per-item
// parse → cache write, under the orchestrator's deadline. Extracted from the
// client so the pipeline stage is testable on its own; the client owns fan-out,
// merge/rerank/gate and meta assembly.
import type { Reference } from './reference'
import { parseReference } from './reference'
import type { KeyValueCache, NormalizedQuery, ProviderContext, ReferenceProvider } from './provider'
import { withTimeout } from './resilience'

// Deterministic JSON for cache keys: object keys sorted recursively, so a
// caller's providerOptions key order can't split otherwise-identical keys.
// Keys whose value is `undefined` are skipped, matching JSON.stringify's own
// object semantics — `{ a: 1, b: undefined }` and `{ a: 1 }` must key alike.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    return `{${Object.keys(rec).filter(k => rec[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Cache key for one provider's slice of a search. Embeds the FULL normalized
 *  query (not a truncated hash): a 32-bit digest would let two different queries
 *  silently collide and serve each other's cached results. Keys can therefore be
 *  a few hundred bytes — KeyValueCache implementations must tolerate that. */
export function providerCacheKey(providerId: string, query: NormalizedQuery): string {
  return `refkit:v1:${providerId}:${stableStringify(query)}`
}

export interface ProviderRunDeps {
  /** Already retry-wrapped by the orchestrator and shared across the fan-out. */
  fetch: typeof fetch
  cache?: KeyValueCache
  cacheTtlMs: number
  /** false → strip `raw` from cached payloads (smaller cache entries; cache-hit
   *  refs then have no `raw`, so raw-reading isDuplicate hooks won't see it). */
  cacheRaw: boolean
  /** Per-provider soft deadline; undefined → no deadline (resilience disabled). */
  timeoutMs?: number
  signal?: AbortSignal
  /** Reports BOTH per-item parse failures and a failed search. */
  onError?: (error: unknown) => void
}

export type ProviderRun =
  | { ok: true; valid: Reference[]; returned: number; latencyMs: number; cached?: boolean }
  | { ok: false; error: unknown; latencyMs: number }

export async function runProviderSearch(
  provider: ReferenceProvider,
  query: NormalizedQuery,
  deps: ProviderRunDeps,
): Promise<ProviderRun> {
  const started = Date.now()
  const timeout = deps.timeoutMs !== undefined ? withTimeout(deps.signal, deps.timeoutMs) : undefined
  const ctx: ProviderContext = {
    fetch: deps.fetch,
    cache: deps.cache,
    signal: timeout?.signal ?? deps.signal,
  }
  const cacheKey = deps.cache ? providerCacheKey(provider.id, query) : undefined
  // Race a promise against the deadline without leaking an unhandled rejection
  // for whichever side loses the race.
  const raceDeadline = <T>(p: Promise<T>): Promise<T> => {
    p.catch(() => {})
    return timeout ? Promise.race([p, timeout.expired]) : p
  }
  // Parse raw provider items one at a time — a single bad item must not
  // discard the rest (shared by the cache-hit and live-search paths).
  const parseItems = (raw: unknown[]): Reference[] => {
    const valid: Reference[] = []
    for (const item of raw) {
      try {
        valid.push(parseReference(item))
      } catch (error) {
        deps.onError?.(error)
      }
    }
    return valid
  }
  try {
    if (deps.cache && cacheKey) {
      // best-effort: a broken/corrupt/stale cache degrades to a live search
      const pending = deps.cache.get(cacheKey)
      // A slow cache read must not outlive the provider deadline: at expiry it
      // degrades to a miss, and the live search below then fails fast on the
      // same (already-expired) deadline.
      const hit = await (timeout
        ? Promise.race([pending, timeout.expired.catch(() => undefined)])
        : pending
      ).catch(() => undefined)
      pending.catch(() => {}) // raced-past rejection must not go unhandled
      if (hit !== undefined) {
        try {
          // cached refs keep their original verifiedAt — staleness is bounded
          // by the TTL when the cache honors ttlMs. Only a whole-payload
          // failure (not JSON, not an array) falls through to live; a single
          // bad item within an otherwise-valid array is reported and dropped,
          // same as the live path.
          const raw = JSON.parse(hit) as unknown[]
          if (!Array.isArray(raw)) throw new Error('cached payload is not an array')
          const valid = parseItems(raw)
          return { ok: true, valid, returned: raw.length, latencyMs: Date.now() - started, cached: true }
        } catch { /* fall through to live */ }
      }
    }
    const searching = provider.search(query, ctx)
    const raw = await raceDeadline(searching)
    const valid = parseItems(raw)
    if (deps.cache && cacheKey) {
      const payload = deps.cacheRaw ? valid : valid.map(({ raw: _raw, ...rest }) => rest)
      // fire-and-forget: cache write failure must never fail the search
      void deps.cache.set(cacheKey, JSON.stringify(payload), deps.cacheTtlMs).catch(() => {})
    }
    return { ok: true, valid, returned: raw.length, latencyMs: Date.now() - started }
  } catch (error) {
    deps.onError?.(error)
    return { ok: false, error, latencyMs: Date.now() - started }
  } finally {
    timeout?.cancel()
  }
}
