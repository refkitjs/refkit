import { describe, expect, it } from 'vitest'
import { hammingDistance, dedupeReferences } from '../dedup'
import type { Reference } from '../reference'

const make = (over: Partial<Reference>): Reference => ({
  id: over.id ?? 'x',
  modality: 'image',
  source: over.source ?? { providerId: 'p', sourceUrl: 'https://x/1' },
  canonicalUrl: over.canonicalUrl ?? 'https://x/1',
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } },
  verifiedAt: '2026-06-22T00:00:00.000Z',
  relevance: over.relevance ?? 0.5,
  perceptualHash: over.perceptualHash,
  ...over,
})

describe('hammingDistance', () => {
  it('counts differing hex nibbles bit-by-bit', () => {
    expect(hammingDistance('ffff', 'ffff')).toBe(0)
    expect(hammingDistance('ffff', 'fffe')).toBe(1) // e = 1110, one bit off
    expect(hammingDistance('0000', 'ffff')).toBe(16)
  })

  it('returns Infinity for unequal lengths', () => {
    expect(hammingDistance('ff', 'ffff')).toBe(Infinity)
  })
})

describe('dedupeReferences', () => {
  it('collapses same canonicalUrl, keeping highest relevance', () => {
    const out = dedupeReferences([
      make({ id: 'a', canonicalUrl: 'https://x/1', relevance: 0.4 }),
      make({ id: 'b', canonicalUrl: 'https://x/1/#frag', relevance: 0.8 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('collapses near-identical perceptual hashes within threshold', () => {
    const out = dedupeReferences([
      make({ id: 'a', canonicalUrl: 'https://x/1', perceptualHash: 'ffff', relevance: 0.9 }),
      make({ id: 'b', canonicalUrl: 'https://y/2', perceptualHash: 'fffe', relevance: 0.3 }),
    ], { hashThreshold: 4 })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })

  it('keeps distinct images apart', () => {
    const out = dedupeReferences([
      make({ id: 'a', canonicalUrl: 'https://x/1', perceptualHash: 'ffff' }),
      make({ id: 'b', canonicalUrl: 'https://y/2', perceptualHash: '0000' }),
    ], { hashThreshold: 4 })
    expect(out).toHaveLength(2)
  })

  it('stale byUrl fix: C(url=a) must not dedupe against hash-replaced B(url=b) via stale index', () => {
    // Step 1: A(url=a, hash=ffff, rel=0.3) → pushed to kept[0]; byUrl = {url_a → 0}
    // Step 2: B(url=b, hash=fffe, rel=0.9) → url_b not in byUrl; hash-distance(fffe,ffff)=1≤4 → merges.
    //         B.rel(0.9) > A.rel(0.3) → B replaces kept[0]. WITHOUT FIX: byUrl still {url_a→0},
    //         now pointing to a slot occupied by B (url=b). url_b was never registered.
    // Step 3: C(url=a, rel=0.5, no hash) → url_a IS in byUrl (stale, pointing to B's slot).
    //         WITHOUT FIX: C incorrectly overwrites B (url=b) with C (url=a), corrupting the slot.
    //         WITH FIX: byUrl correctly maps url_b→0 after replacement, so url_a lookup misses,
    //         C is appended as a new entry. Final: [B(url=b), C(url=a)] length=2.
    const out = dedupeReferences([
      make({ id: 'A', canonicalUrl: 'https://a/1', perceptualHash: 'ffff', relevance: 0.3 }),
      make({ id: 'B', canonicalUrl: 'https://b/2', perceptualHash: 'fffe', relevance: 0.9 }),
      make({ id: 'C', canonicalUrl: 'https://a/1', relevance: 0.5 }),
    ], { hashThreshold: 4 })
    // A and B hash-merge (distance=1 ≤ 4), B wins (higher relevance, url=b).
    // C has url=a which, after the fix, is NOT in byUrl (it was deleted when B replaced A).
    // C must be added as a fresh entry, not incorrectly merged into slot 0 (B's slot).
    // Expected: [B, C] — two entries.
    expect(out).toHaveLength(2)
    const ids = out.map(r => r.id)
    expect(ids).toContain('B')
    expect(ids).toContain('C')
  })
})
