import { describe, expect, it } from 'vitest'
import type { ReferenceProvider } from '@refkit/core'
import { searchConformant, type ConformanceOptions } from './index'

/** Register an env-gated live smoke suite for a provider. Runs only with
 *  REFKIT_LIVE=1 (and, if keyEnv given, that env var set). One real query,
 *  full conformance assertions, 30s timeout. */
export function liveSmoke(
  name: string,
  make: () => ReferenceProvider,
  opts: ConformanceOptions & { keyEnv?: string } = {},
): void {
  const enabled = process.env.REFKIT_LIVE === '1' && (!opts.keyEnv || !!process.env[opts.keyEnv])
  describe.skipIf(!enabled)(`live smoke: ${name}`, () => {
    it('returns conformant references from the real API', { timeout: 30_000 }, async () => {
      const refs = await searchConformant(make(), globalThis.fetch, opts)
      expect(refs.length).toBeGreaterThan(0)
    })
  })
}
