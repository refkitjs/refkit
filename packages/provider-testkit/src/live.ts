import { describe, expect, it } from 'vitest'
import type { ReferenceProvider } from '@refkit/core'
import { searchConformant, type ConformanceOptions } from './index'

/** Register an env-gated live smoke suite for a provider. Runs only with
 *  REFKIT_LIVE=1 (and, if keyEnv given, that env var set). One real query,
 *  full conformance assertions, 30s timeout.
 *
 *  `tolerateUpstreamBlock`: for sources behind a WAF that 403s datacenter IPs
 *  (gutendex/Cloudflare — verified unfixable client-side: descriptive and
 *  browser UAs are both blocked). A WAF 403 says nothing about API drift, which
 *  is what this suite exists to detect, so it SKIPS with a warning instead of
 *  failing the weekly run. Strictly scoped: only HTTP 403 is tolerated — 404s,
 *  5xx, schema changes, and empty results still fail. */
export function liveSmoke(
  name: string,
  make: () => ReferenceProvider,
  opts: ConformanceOptions & { keyEnv?: string; tolerateUpstreamBlock?: boolean } = {},
): void {
  const enabled = process.env.REFKIT_LIVE === '1' && (!opts.keyEnv || !!process.env[opts.keyEnv])
  describe.skipIf(!enabled)(`live smoke: ${name}`, () => {
    it('returns conformant references from the real API', { timeout: 30_000 }, async (t) => {
      let refs
      try {
        refs = await searchConformant(make(), globalThis.fetch, opts)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (opts.tolerateUpstreamBlock && /\b403\b/.test(message)) {
          console.warn(`[live-smoke] ${name}: upstream WAF returned 403 from this runner — inconclusive for drift, skipping. (${message})`)
          t.skip()
          return
        }
        throw e
      }
      expect(refs.length).toBeGreaterThan(0)
    })
  })
}
