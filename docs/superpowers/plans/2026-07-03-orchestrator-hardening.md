# Wave 2 — Orchestrator Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-provider soft timeout + retry-with-backoff, per-provider `latencyMs` metadata, and an opt-in per-provider result cache on the existing `KeyValueCache` port — all in `@refkit/core`, honoring decisions H8–H11 in `2026-07-03-hardening-index.md`.

**Architecture:** New focused module `packages/core/src/resilience.ts` (signal composition + retrying fetch — pure, zero-network). `client.ts`'s fan-out refactors into a per-provider `runProvider` (own ctx, timeout race, latency measurement, cache), replacing `Promise.allSettled` with never-throwing discriminated results. `evaluateUse`/merge/rerank untouched.

**Tech Stack:** TypeScript ESM, vitest (fake timers), zod. No new dependencies. Branch: `m13t/wave2-orchestrator-hardening`.

**Locked decisions (do not re-litigate):** H8 defaults ON (`timeoutMs: 10_000`, `retries: 1`, retry only 429/5xx/network-error; `resilience: false` disables); H9 no `AbortSignal.any` (manual composition; `setTimeout` in core is fine — the no-network test only bans `fetch(` calls and `http(s)://` literals); H10 cache per-provider pre-merge, key `refkit:v1:<providerId>:<fnv1a(JSON(normalizedQuery))>`, TTL `cacheTtlMs` default 300_000, hits marked `cached: true`; H11 `latencyMs` around each provider run.

---

### Task W2.1: `resilience.ts` — `withTimeout` + `retryingFetch`

**Files:**
- Create: `packages/core/src/resilience.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/__tests__/resilience.test.ts`

- [ ] **Step 1: Write the failing tests** — create `resilience.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { retryingFetch, withTimeout } from '../resilience'

const okResponse = () => new Response('ok', { status: 200 })
const status = (s: number) => new Response('x', { status: s })

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('aborts the signal and rejects `expired` after timeoutMs', async () => {
    const t = withTimeout(undefined, 1000)
    expect(t.signal.aborted).toBe(false)
    const raced = Promise.race([new Promise(() => {}), t.expired]).catch(e => e)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.signal.aborted).toBe(true)
    expect(String(await raced)).toContain('timeout after 1000ms')
    t.cancel()
  })

  it('propagates a parent abort immediately', async () => {
    const parent = new AbortController()
    const t = withTimeout(parent.signal, 60_000)
    parent.abort()
    expect(t.signal.aborted).toBe(true)
    t.cancel()
  })

  it('cancel() clears the timer so nothing fires later', async () => {
    const t = withTimeout(undefined, 1000)
    t.cancel()
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.signal.aborted).toBe(false)
  })
})

describe('retryingFetch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries a 500 then returns the success', async () => {
    const impl = vi.fn().mockResolvedValueOnce(status(500)).mockResolvedValueOnce(okResponse())
    const f = retryingFetch(impl as unknown as typeof fetch, { retries: 1 })
    const p = f('https://x/')
    await vi.runAllTimersAsync()
    expect((await p).status).toBe(200)
    expect(impl).toHaveBeenCalledTimes(2)
  })

  it('retries 429 and a rejected network error', async () => {
    const impl = vi.fn()
      .mockResolvedValueOnce(status(429))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse())
    const f = retryingFetch(impl as unknown as typeof fetch, { retries: 2 })
    const p = f('https://x/')
    await vi.runAllTimersAsync()
    expect((await p).status).toBe(200)
    expect(impl).toHaveBeenCalledTimes(3)
  })

  it('returns the last 5xx response (does not throw) once retries are exhausted', async () => {
    const impl = vi.fn().mockResolvedValue(status(503))
    const f = retryingFetch(impl as unknown as typeof fetch, { retries: 1 })
    const p = f('https://x/')
    await vi.runAllTimersAsync()
    expect((await p).status).toBe(503)
    expect(impl).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable statuses (400/404)', async () => {
    const impl = vi.fn().mockResolvedValue(status(404))
    const f = retryingFetch(impl as unknown as typeof fetch, { retries: 3 })
    expect((await f('https://x/')).status).toBe(404)
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it('does not retry after an abort; abort during backoff cancels the wait', async () => {
    const ac = new AbortController()
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const impl = vi.fn().mockRejectedValue(abortErr)
    const f = retryingFetch(impl as unknown as typeof fetch, { retries: 3 })
    await expect(f('https://x/', { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(impl).toHaveBeenCalledTimes(1)

    const impl2 = vi.fn().mockResolvedValue(status(500))
    const f2 = retryingFetch(impl2 as unknown as typeof fetch, { retries: 3 })
    const p2 = f2('https://x/', { signal: ac.signal }).catch(e => e)
    ac.abort()
    await vi.runAllTimersAsync()
    await p2
    expect(impl2).toHaveBeenCalledTimes(1) // aborted before/during first backoff — no second attempt
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run packages/core/src/__tests__/resilience.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `packages/core/src/resilience.ts` (zero-network: no `fetch(` call, no endpoint literals — the injected impl is always named `fetchImpl`):

```ts
// Resilience primitives for the search orchestrator (H8/H9). Pure: the fetch
// implementation is always injected; core never references a global fetch.

export interface TimeoutHandle {
  /** Aborts when the parent aborts OR the timer fires. Pass as ProviderContext.signal. */
  signal: AbortSignal
  /** Rejects with `timeout after Nms` when the timer fires. Race the provider against it. */
  expired: Promise<never>
  /** Clear the timer + detach the parent listener. ALWAYS call once settled. */
  cancel(): void
}

/** Compose a parent signal with a deadline — manual composition, no AbortSignal.any
 *  (H9: keeps core runtime-agnostic). */
export function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): TimeoutHandle {
  const ctrl = new AbortController()
  const onParentAbort = () => ctrl.abort(parent?.reason)
  if (parent?.aborted) ctrl.abort(parent.reason)
  else parent?.addEventListener('abort', onParentAbort, { once: true })

  let rejectExpired: (e: Error) => void
  const expired = new Promise<never>((_, reject) => { rejectExpired = reject })
  expired.catch(() => {}) // the race may settle first; never let this become an unhandled rejection
  const timer = setTimeout(() => {
    const err = new Error(`timeout after ${timeoutMs}ms`)
    ctrl.abort(err)
    rejectExpired(err)
  }, timeoutMs)

  return {
    signal: ctrl.signal,
    expired,
    cancel() {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    },
  }
}

export interface RetryOptions {
  /** Extra attempts after the first (H8 default 1). */
  retries: number
  /** Base backoff delay; grows 2^attempt with full jitter. Default 250. */
  baseDelayMs?: number
}

function abortAware(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const onAbort = () => { clearTimeout(t); reject(signal?.reason ?? new Error('aborted')) }
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const isRetryableStatus = (s: number) => s === 429 || s >= 500

/** Wrap an injected fetch with bounded retries on 429/5xx/network-error (H8).
 *  Aborts are never retried; an exhausted 429/5xx returns the response so the
 *  provider's own `!res.ok` error path still owns the failure message. */
export function retryingFetch(fetchImpl: typeof fetch, opts: RetryOptions): typeof fetch {
  const base = opts.baseDelayMs ?? 250
  const wrapped = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(input, init)
        if (!isRetryableStatus(res.status) || attempt >= opts.retries) return res
      } catch (err) {
        const name = (err as { name?: string } | null)?.name
        if (name === 'AbortError' || init?.signal?.aborted || attempt >= opts.retries) throw err
      }
      // exponential backoff with full jitter; an abort during the wait cancels the retry
      await abortAware(base * 2 ** attempt * (0.5 + Math.random() * 0.5), init?.signal)
    }
  }
  return wrapped as typeof fetch
}
```

Add to `packages/core/src/index.ts` (new lines, keep existing exports):

```ts
export { withTimeout, retryingFetch } from './resilience'
export type { TimeoutHandle, RetryOptions } from './resilience'
```

- [ ] **Step 4: Run** — `pnpm exec vitest run packages/core && pnpm --filter @refkit/core typecheck` → PASS, including `no-network.test.ts` (it scans every core source file — `resilience.ts` must not trip `\bfetch\s*\(` or `https?://`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/resilience.ts packages/core/src/index.ts packages/core/src/__tests__/resilience.test.ts
git commit -m "feat(core): resilience primitives — withTimeout + retryingFetch"
```

---

### Task W2.2: client.ts — per-provider timeout, retries, latencyMs

**Files:**
- Modify: `packages/core/src/client.ts`
- Test: `packages/core/src/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing tests.** In `client.test.ts` add (fake timers are needed ONLY in the timeout tests — scope them per-test exactly as shown, so the other async tests keep real timers):

```ts
  it('times out a hanging provider, returns partial results, and reports the timeout', async () => {
    vi.useFakeTimers()
    try {
      const hanging = defineProvider({
        id: 'hang', modalities: ['image'], queryFeatures: ['keyword'],
        search: () => new Promise(() => {}), // never settles, ignores ctx.signal
      })
      const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), hanging] })
      const p = rk.searchWithMeta({ query: 'x', modalities: ['image'] })
      await vi.advanceTimersByTimeAsync(10_000)
      const out = await p
      expect(out.references).toHaveLength(1)
      const hangStatus = out.meta.providers.find(s => s.providerId === 'hang')
      expect(hangStatus?.status).toBe('failed')
      expect(hangStatus?.error).toContain('timeout after 10000ms')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resilience: false disables the timeout entirely', async () => {
    vi.useFakeTimers()
    try {
      let done = false
      const slow = defineProvider({
        id: 'slow', modalities: ['image'], queryFeatures: ['keyword'],
        search: () => new Promise(resolve => setTimeout(() => { done = true; resolve([ref('slow-1', 'https://s/1')]) }, 60_000)),
      })
      const rk = createRefkit({ providers: [slow], resilience: false })
      const p = rk.search({ query: 'x', modalities: ['image'] })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await p).toHaveLength(1)
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives providers a retrying ctx.fetch: a 500-then-200 upstream succeeds transparently', async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const usesFetch = defineProvider({
      id: 'net', modalities: ['image'], queryFeatures: ['keyword'],
      search: async (_q, ctx) => {
        const res = await ctx.fetch('https://net/api', { signal: ctx.signal })
        if (!res.ok) throw new Error(`net failed: ${res.status}`)
        return [ref('net-1', 'https://net/1')]
      },
    })
    const rk = createRefkit({ providers: [usesFetch], fetch: upstream as unknown as typeof fetch, resilience: { retries: 1, timeoutMs: 10_000 } })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(1)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('reports latencyMs on fulfilled and failed providers, not on skipped', async () => {
    const textOnly = defineProvider({ id: 'text', modalities: ['text'], queryFeatures: [], search: async () => [] })
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')]), failing('bad'), textOnly] })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'] })
    const byId = Object.fromEntries(out.meta.providers.map(s => [s.providerId, s]))
    expect(byId.a.latencyMs).toEqual(expect.any(Number))
    expect(byId.bad.latencyMs).toEqual(expect.any(Number))
    expect(byId.text.latencyMs).toBeUndefined()
  })
```

ALSO update the existing strict assertion in `'searchWithMeta returns provider status, warnings, and gate summary'` (~line 217): statuses now carry `latencyMs`, so replace the `toEqual([...])` with:

```ts
    expect(out.meta.providers).toEqual([
      { providerId: 'ok', status: 'fulfilled', returned: 2, accepted: 2, rejected: 0, latencyMs: expect.any(Number) },
      { providerId: 'bad', status: 'failed', error: 'boom', latencyMs: expect.any(Number) },
      { providerId: 'text', status: 'skipped', reason: 'unsupported-modality' },
    ])
```

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run packages/core/src/__tests__/client.test.ts` → new tests FAIL (typecheck: `resilience` option unknown).

- [ ] **Step 3: Implement in `client.ts`:**

Types (additions):

```ts
export interface ResilienceOptions {
  /** Soft deadline per provider search. Default 10_000. */
  timeoutMs?: number
  /** Extra fetch attempts on 429/5xx/network-error. Default 1. */
  retries?: number
}

export interface RefkitOptions {
  providers: ReferenceProvider[]
  fetch?: typeof fetch
  cache?: KeyValueCache
  signal?: AbortSignal
  merge?: MergeOptions
  /** Per-provider timeout + retry (H8). Defaults ON; pass `false` to disable both. */
  resilience?: ResilienceOptions | false
}
```

`ProviderSearchStatus` gains `latencyMs?: number` (fulfilled/failed only).

Imports: `import { retryingFetch, withTimeout } from './resilience'`. Constants: `const DEFAULT_TIMEOUT_MS = 10_000`, `const DEFAULT_RETRIES = 1`.

Replace the shared-ctx + `Promise.allSettled` block (currently `const ctx: ProviderContext = {...}` through the whole `settled.forEach`) with a per-provider runner. The discriminated result keeps every downstream shape intact:

```ts
    const resilience = options.resilience === false ? undefined : {
      timeoutMs: options.resilience?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: options.resilience?.retries ?? DEFAULT_RETRIES,
    }

    type ProviderRun =
      | { ok: true; valid: Reference[]; returned: number; latencyMs: number }
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
        })
        perSource.push(run.valid)
      } else {
        statusByProvider.set(provider.id, { providerId: provider.id, status: 'failed', error: errorSummary(run.error), latencyMs: run.latencyMs })
      }
    })

    if (!anyOk) {
      throw new AggregateError(runs.filter(r => !r.ok).map(r => (r as { error: unknown }).error), 'refkit.search: all providers failed')
    }
```

Notes for the implementer: `errorSummary` already renders `Error.message`, so the timeout error surfaces as `timeout after 10000ms`. The old `settled.forEach` block and the shared `ctx` are deleted — `onProviderError` for provider failure now fires inside `runProvider` (was previously fired in the forEach; keep exactly one call per failure). Export `ResilienceOptions` from `client.ts` and add it to the type re-exports in `packages/core/src/index.ts`.

- [ ] **Step 4: Run** — `pnpm exec vitest run packages/core && pnpm --filter @refkit/core typecheck` → PASS (all pre-existing client tests must stay green — the AggregateError, onProviderError, malformed-item, and rerank-signal tests exercise the refactored path).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/client.ts packages/core/src/index.ts packages/core/src/__tests__/client.test.ts
git commit -m "feat(core): per-provider timeout, retrying fetch, latencyMs in search meta"
```

---

### Task W2.3: per-provider result cache on the KeyValueCache port

**Files:**
- Modify: `packages/core/src/client.ts`
- Test: `packages/core/src/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing tests** — add to `client.test.ts`:

```ts
  const mapCache = () => {
    const m = new Map<string, string>()
    return {
      store: m,
      ttls: [] as (number | undefined)[],
      async get(k: string) { return m.get(k) },
      async set(k: string, v: string, ttlMs?: number) { m.set(k, v); this.ttls.push(ttlMs) },
    }
  }

  it('serves a repeat query from the cache without re-hitting the provider', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] })
    const out = await rk.searchWithMeta({ query: 'x', modalities: ['image'] })
    expect(calls).toBe(1)
    expect(out.references).toHaveLength(1)
    expect(out.meta.providers[0]).toMatchObject({ status: 'fulfilled', cached: true })
    expect(cache.ttls).toEqual([300_000]) // default cacheTtlMs, one set for the first (live) search
  })

  it('different queries use different cache keys', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] })
    await rk.search({ query: 'y', modalities: ['image'] })
    expect(calls).toBe(2)
  })

  it('a corrupt or invalid cache entry falls back to a live fetch', async () => {
    const cache = mapCache()
    let calls = 0
    const counted = defineProvider({
      id: 'c', modalities: ['image'], queryFeatures: ['keyword'],
      search: async () => { calls++; return [ref('c-1', 'https://c/1')] },
    })
    const rk = createRefkit({ providers: [counted], cache })
    await rk.search({ query: 'x', modalities: ['image'] })
    for (const k of cache.store.keys()) cache.store.set(k, '{not json')
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(calls).toBe(2)
  })

  it('cache errors are non-fatal: a throwing cache degrades to live search', async () => {
    const broken = {
      async get(): Promise<string | undefined> { throw new Error('cache down') },
      async set(): Promise<void> { throw new Error('cache down') },
    }
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')])], cache: broken })
    const out = await rk.search({ query: 'x', modalities: ['image'] })
    expect(out).toHaveLength(1)
  })

  it('honors a custom cacheTtlMs', async () => {
    const cache = mapCache()
    const rk = createRefkit({ providers: [provider('a', [ref('a-1', 'https://a/1')])], cache, cacheTtlMs: 1234 })
    await rk.search({ query: 'x', modalities: ['image'] })
    expect(cache.ttls).toEqual([1234])
  })
```

- [ ] **Step 2: Run to verify failure** — cache is currently passed into ctx but never used by the client → repeat-query test FAILS (calls === 2), `cached`/`cacheTtlMs` don't typecheck.

- [ ] **Step 3: Implement in `client.ts`:**

Types: `RefkitOptions` gains `/** TTL for per-provider cached results; used only when `cache` is set. Default 300_000. */ cacheTtlMs?: number`. `ProviderSearchStatus` gains `cached?: boolean`. `ProviderRun`'s ok-arm gains `cached?: boolean`. Import `fnv1a` from `./hash` and `referenceSchema` (or reuse `parseReference` per item) from `./reference`. Constant `const DEFAULT_CACHE_TTL_MS = 300_000`.

Inside `runProvider`, wrap the live path (H10 — per-provider, PRE-merge, stores only validated refs):

```ts
      const cacheKey = options.cache
        ? `refkit:v1:${p.id}:${fnv1a(JSON.stringify(query))}`
        : undefined
      if (options.cache && cacheKey) {
        // best-effort: a broken/corrupt/stale cache degrades to a live search
        const hit = await options.cache.get(cacheKey).catch(() => undefined)
        if (hit !== undefined) {
          try {
            const parsed = (JSON.parse(hit) as unknown[]).map(item => parseReference(item))
            return { ok: true, valid: parsed, returned: parsed.length, latencyMs: Date.now() - started, cached: true }
          } catch { /* fall through to live */ }
        }
      }
```

…and after the live `valid` array is built (only on the ok path, before `return`):

```ts
      if (options.cache && cacheKey) {
        // fire-and-forget: cache write failure must never fail the search
        void options.cache.set(cacheKey, JSON.stringify(valid), options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS).catch(() => {})
      }
```

Status mapping: spread `...(run.cached ? { cached: true } : {})` into the fulfilled status. Note in a comment that cached refs keep their original `verifiedAt` (staleness bounded by the TTL).

- [ ] **Step 4: Run** — `pnpm exec vitest run packages/core && pnpm --filter @refkit/core typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/client.ts packages/core/src/__tests__/client.test.ts
git commit -m "feat(core): per-provider result cache on the KeyValueCache port"
```

---

### Task W2.4: docs, changeset, full verify

**Files:**
- Modify: `README.md`
- Create: `.changeset/orchestrator-hardening.md`

- [ ] **Step 1: README.** Two edits:
  1. In the Quickstart code block, the comment `// fetch defaults to globalThis.fetch — inject your own to add caching/retries` is now stale → change to `// fetch defaults to globalThis.fetch — timeouts/retries/caching are built in (see below)`.
  2. After the "Ranking & rerank" section add:

```md
## Resilience & caching

Fan-out is hardened by default: each provider gets a **soft 10s timeout** and **one retry** (429/5xx/network errors, exponential backoff). A slow or hanging source is reported in `meta.providers` as `failed` with `timeout after Nms` — the search still returns everyone else. Tune or disable per client:

```ts
createRefkit({ providers, resilience: { timeoutMs: 4000, retries: 2 } })
createRefkit({ providers, resilience: false }) // raw fan-out, no timeout/retry
```

Pass a `cache` to memoize **per-provider** results (keyed by provider + normalized query, TTL `cacheTtlMs`, default 5 min). Merging, reranking, and the license gate always run fresh; cache hits are flagged `cached: true` in `meta.providers`, and every provider status carries `latencyMs`:

```ts
createRefkit({ providers, cache: myKvCache, cacheTtlMs: 60_000 })
```
```

- [ ] **Step 2: Changeset** — create `.changeset/orchestrator-hardening.md`:

```md
---
"@refkit/core": minor
---

Harden the search orchestrator: per-provider soft timeout (default 10s) and
bounded retry on 429/5xx/network errors (default 1, exponential backoff) — on by
default, tunable or disabled via `createRefkit({ resilience })`. Provider
statuses in `searchWithMeta` now carry `latencyMs`, and supplying a `cache`
(`KeyValueCache`) now memoizes per-provider results (key
`refkit:v1:<provider>:<queryHash>`, TTL `cacheTtlMs`, default 5 min) with hits
flagged `cached: true`. Merge, rerank, and the license gate always run fresh.
New exports: `withTimeout`, `retryingFetch`, `ResilienceOptions`.
```

- [ ] **Step 3: Full verify** — `pnpm -r --parallel typecheck && pnpm test:run` → ALL green (Wave 1 baseline 259 + the new resilience/client tests). Confirm `no-network` still green.

- [ ] **Step 4: Commit**

```bash
git add README.md .changeset/orchestrator-hardening.md
git commit -m "docs: resilience & caching section + changeset for orchestrator hardening"
```

---

## Self-review notes

- H8 (Task W2.2), H9 (Task W2.1 — no AbortSignal.any; no-network stays green), H10 (Task W2.3), H11 (Task W2.2).
- The pre-existing strict `toEqual` on `meta.providers` (~client.test.ts:217) is explicitly updated in Task W2.2 — do not skip it.
- MCP's `searchMetaSchema` (packages/mcp/src/index.ts) validates provider statuses — check in Task W2.4's full verify: its zod object for providers has no `latencyMs`/`cached` keys; zod objects strip unknown keys by default, but the schema is typed `z.ZodType<SearchMeta>` — if typecheck fails there, add `latencyMs: z.number().optional(), cached: z.boolean().optional()` to the mcp provider-status schema and include the file in Task W2.4's commit with a note.
- Line anchors may drift — locate by quoted code.
