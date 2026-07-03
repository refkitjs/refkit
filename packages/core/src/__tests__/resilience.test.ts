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

  it('drains (cancels) the body of a discarded retryable response, never the returned one', async () => {
    const res500 = status(500)
    const res200 = okResponse()
    expect(res500.body).not.toBeNull() // guard: the spies below must target real streams
    expect(res200.body).not.toBeNull()
    const cancelSpy500 = vi.spyOn(res500.body!, 'cancel')
    const cancelSpy200 = vi.spyOn(res200.body!, 'cancel')
    const impl = vi.fn().mockResolvedValueOnce(res500).mockResolvedValueOnce(res200)
    const f = retryingFetch(impl as unknown as typeof fetch, { retries: 1 })
    const p = f('https://x/')
    await vi.runAllTimersAsync()
    expect((await p).status).toBe(200)
    expect(cancelSpy500).toHaveBeenCalledTimes(1)
    expect(cancelSpy200).not.toHaveBeenCalled() // never drained on the return path
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

  it('does not retry a deadline abort even when the rejection is a plain Error (not name AbortError)', async () => {
    // undici rejects fetch with the abort *reason* when the signal fires — and
    // withTimeout's reason is a plain `Error('timeout after Nms')` whose name is
    // 'Error', not 'AbortError'. retryingFetch must still recognize this as an
    // abort via `init?.signal?.aborted` and not burn a retry on it.
    const ac = new AbortController()
    const timeoutErr = new Error('timeout after 100ms')
    const impl = vi.fn().mockImplementation(() => {
      ac.abort(timeoutErr)
      return Promise.reject(timeoutErr)
    })
    const f = retryingFetch(impl as unknown as typeof fetch, { retries: 3 })
    await expect(f('https://x/', { signal: ac.signal })).rejects.toBe(timeoutErr)
    expect(impl).toHaveBeenCalledTimes(1)
  })
})
