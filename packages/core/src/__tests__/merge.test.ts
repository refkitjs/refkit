import { describe, expect, it } from 'vitest'
import { mergeReferences, stricterLicense, type RightsConflict } from '../merge'
import type { Reference } from '../reference'
import type { LicenseId } from '../license'

const make = (id: string, url: string, hash?: string): Reference => ({
  id,
  modality: 'image',
  source: { providerId: id.split('-')[0], sourceUrl: url },
  canonicalUrl: url,
  rights: { license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: url } },
  verifiedAt: '2026-06-22T00:00:00.000Z',
  relevance: 0,
  perceptualHash: hash,
})

const withLicense = (ref: Reference, license: LicenseId, licenseVersion?: string): Reference => ({
  ...ref,
  rights: { ...ref.rights, license, licenseVersion },
})

describe('mergeReferences (RRF)', () => {
  it('returns a single ranked list with relevance in 0..1, top item = 1', () => {
    const out = mergeReferences([
      [make('a-1', 'https://a/1'), make('a-2', 'https://a/2')],
      [make('b-1', 'https://b/1')],
    ])
    expect(out.length).toBe(3)
    expect(out[0].relevance).toBe(1)
    for (const r of out) expect(r.relevance).toBeGreaterThan(0)
  })

  it('an item ranked highly in two sources beats items ranked once', () => {
    // same canonicalUrl appears top in both lists -> should rank first
    const out = mergeReferences([
      [make('a-1', 'https://shared/1'), make('a-2', 'https://a/2')],
      [make('b-1', 'https://shared/1'), make('b-2', 'https://b/2')],
    ])
    expect(out[0].canonicalUrl).toBe('https://shared/1')
  })

  it('dedupes after fusion', () => {
    const out = mergeReferences([
      [make('a-1', 'https://shared/1')],
      [make('b-1', 'https://shared/1')],
    ])
    expect(out).toHaveLength(1)
  })

  it('returns [] for empty / all-empty input without throwing', () => {
    expect(mergeReferences([])).toEqual([])
    expect(mergeReferences([[], []])).toEqual([])
  })

  it('resolves a cross-source license conflict to the stricter license, regardless of source order', () => {
    const a = withLicense(make('a-1', 'https://shared/1'), 'CC-BY')
    const b = withLicense(make('b-1', 'https://shared/1'), 'CC-BY-NC')
    for (const perSource of [[[a], [b]], [[b], [a]]]) {
      const out = mergeReferences(perSource)
      expect(out).toHaveLength(1)
      expect(out[0].rights.license).toBe('CC-BY-NC')
    }
  })

  it('collapses an incomparable license conflict to unknown (strict-deny) and drops licenseVersion', () => {
    // unsplash grants derivatives but not redistribution; CC-BY-ND the reverse —
    // neither dominates, so no single honest license id exists.
    const a = withLicense(make('a-1', 'https://shared/1'), 'CC-BY-ND', '4.0')
    const b = withLicense(make('b-1', 'https://shared/1'), 'unsplash')
    const out = mergeReferences([[a], [b]])
    expect(out).toHaveLength(1)
    expect(out[0].rights.license).toBe('unknown')
    expect(out[0].rights.licenseVersion).toBeUndefined()
  })

  it('reports conflicts via onRightsConflict; same-license duplicates never conflict', () => {
    const seen: RightsConflict[] = []
    const a = withLicense(make('a-1', 'https://shared/1'), 'CC0-1.0')
    const b = withLicense(make('b-1', 'https://shared/1'), 'proprietary')
    const c1 = withLicense(make('a-2', 'https://same/2'), 'CC-BY', '4.0')
    const c2 = withLicense(make('b-2', 'https://same/2'), 'CC-BY', '2.0')
    const out = mergeReferences([[a, c1], [b, c2]], { onRightsConflict: (c) => seen.push(c) })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      canonicalUrl: 'https://shared/1',
      licenses: ['CC0-1.0', 'proprietary'],
      resolvedLicense: 'proprietary',
    })
    const shared = out.find(r => r.canonicalUrl === 'https://shared/1')!
    expect(shared.rights.license).toBe('proprietary')
    // same license id, different version: not a conflict, representative's record kept
    const same = out.find(r => r.canonicalUrl === 'https://same/2')!
    expect(same.rights.license).toBe('CC-BY')
  })

  it('stricterLicense: dominance picks the stricter; incomparable pairs return undefined', () => {
    expect(stricterLicense('CC-BY', 'CC-BY-NC')).toBe('CC-BY-NC')
    expect(stricterLicense('CC0-1.0', 'proprietary')).toBe('proprietary')
    expect(stricterLicense('CC0-1.0', 'PD')).toBeDefined() // equal permissiveness — either
    expect(stricterLicense('unsplash', 'CC-BY-ND')).toBeUndefined()
    expect(stricterLicense('CC-BY-SA', 'unknown')).toBe('unknown') // unknown grants nothing determinable
  })

  it('handles a large pool without a Math.max(...spread) stack overflow', () => {
    // The fused-score max must not be computed via `Math.max(...scores)`: spreading
    // ~10^5 args overflows the call stack (RangeError). Pool size here is well past
    // that threshold so a regression to the spread form fails loudly.
    const big = Array.from({ length: 200_000 }, (_, i) => make(`p-${i}`, `https://p/${i}`))
    const out = mergeReferences([big])
    expect(out).toHaveLength(200_000)
    expect(out[0].relevance).toBe(1) // top still normalised to exactly 1.0
  })
})
