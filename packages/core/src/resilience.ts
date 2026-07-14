// Resilience primitives for the search orchestrator (H8/H9). Pure: the fetch
// implementation is always injected; core never references a global fetch.

export interface TimeoutHandle {
  /** Aborts when the parent aborts OR the timer fires. Pass as ProviderContext.signal. */
  signal: AbortSignal
  /** Rejects when the deadline fires (`timeout after Nms`) OR the parent aborts
   *  (with the parent's reason) — whichever comes first. Race the provider against
   *  it so a user abort fast-fails even a provider that ignores ctx.signal. */
  expired: Promise<never>
  /** Clear the timer + detach the parent listener. ALWAYS call once settled. */
  cancel(): void
}

/** Compose a parent signal with a deadline — manual composition, no AbortSignal.any
 *  (H9: keeps core runtime-agnostic). */
export function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): TimeoutHandle {
  const ctrl = new AbortController()

  let rejectExpired: (e: Error) => void
  const expired = new Promise<never>((_, reject) => { rejectExpired = reject })
  expired.catch(() => {}) // the race may settle first; never let this become an unhandled rejection

  const timer = setTimeout(() => {
    const err = new Error(`timeout after ${timeoutMs}ms`)
    ctrl.abort(err)
    rejectExpired(err)
  }, timeoutMs)

  const onParentAbort = () => {
    clearTimeout(timer) // self-clean: a parent abort makes the deadline moot
    ctrl.abort(parent?.reason)
    rejectExpired(parent?.reason instanceof Error ? parent.reason : new Error(String(parent?.reason ?? 'aborted')))
  }
  if (parent?.aborted) onParentAbort()
  else parent?.addEventListener('abort', onParentAbort, { once: true })

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
  /** Extra attempts after the first. The orchestrator passes its own default (H8: 1). */
  retries: number
  /** Base backoff delay; grows 2^attempt with equal jitter. Default 250. */
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
    // A signal can be carried on `init.signal` OR on a `Request` object passed
    // as `input` — `init.signal` takes precedence (matches fetch's own rule).
    const signal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
    for (let attempt = 0; ; attempt++) {
      let discarded: Response | undefined
      try {
        const res = await fetchImpl(input, init)
        if (!isRetryableStatus(res.status) || attempt >= opts.retries) return res
        discarded = res
      } catch (err) {
        const name = (err as { name?: string } | null)?.name
        if (name === 'AbortError' || signal?.aborted || attempt >= opts.retries) throw err
      }
      // drain the discarded body so undici can reuse the socket during retries
      void discarded?.body?.cancel().catch(() => {})
      // exponential backoff with equal jitter (half fixed + half random); an abort during the wait cancels the retry
      await abortAware(base * 2 ** attempt * (0.5 + Math.random() * 0.5), signal)
    }
  }
  return wrapped as typeof fetch
}
