import { describe, expect, it } from 'vitest'
import { evaluatePermissions, evaluateUse, NOT_LEGAL_ADVICE } from '../evaluate-use'
import type { RightsRecord } from '../rights'
import { LICENSE_FACTS } from '../license'
import type { LicenseId } from '../license'

const rec = (license: LicenseId, extra: Partial<RightsRecord> = {}): RightsRecord => ({
  license,
  rehostPolicy: 'cache-allowed',
  raw: { sourceTerms: 't', sourceUrl: 'u' },
  ...extra,
})

describe('evaluateUse — strict-deny', () => {
  it('always attaches the not-legal-advice disclaimer', () => {
    expect(evaluateUse(rec('CC0-1.0'), 'commercial-product').disclaimer).toBe(NOT_LEGAL_ADVICE)
  })

  it('CC0 → allowed for commercial use, high confidence', () => {
    const v = evaluateUse(rec('CC0-1.0'), 'commercial-product')
    expect(v.decision).toBe('allowed')
    expect(v.confidence).toBe('high')
  })

  it('CC-BY → allowed-with-attribution for commercial use', () => {
    expect(evaluateUse(rec('CC-BY'), 'commercial-product').decision).toBe('allowed-with-attribution')
  })

  it('unknown license → needs-review, low confidence (never allowed)', () => {
    const v = evaluateUse(rec('unknown'), 'commercial-product')
    expect(v.decision).toBe('needs-review')
    expect(v.confidence).toBe('low')
  })

  it('proprietary → denied for commercial/ai/redistribution', () => {
    expect(evaluateUse(rec('proprietary'), 'commercial-product').decision).toBe('denied')
    expect(evaluateUse(rec('proprietary'), 'ai-generation-input').decision).toBe('denied')
    expect(evaluateUse(rec('proprietary'), 'redistribution').decision).toBe('denied')
  })

  it('ai-generation-input requires BOTH commercial use AND derivatives', () => {
    // unsplash: commercial yes, derivatives yes → allowed
    expect(evaluateUse(rec('unsplash'), 'ai-generation-input').decision).toBe('allowed')
    // proprietary: derivatives false → denied
    expect(evaluateUse(rec('proprietary'), 'ai-generation-input').decision).toBe('denied')
  })

  it('redistribution: stock licenses (no redistribution) → denied even though commercial', () => {
    expect(evaluateUse(rec('unsplash'), 'redistribution').decision).toBe('denied')
  })

  it('editorialOnly + commercial intent → denied', () => {
    expect(evaluateUse(rec('CC0-1.0', { editorialOnly: true }), 'commercial-product').decision).toBe('denied')
  })

  it('internal-moodboard is lenient for known licenses but needs-review for unknown', () => {
    const v = evaluateUse(rec('CC-BY'), 'internal-moodboard')
    expect(v.decision).toBe('allowed')
    expect(v.reasons.some(r => r.includes('attribution required'))).toBe(true)
    expect(evaluateUse(rec('unknown'), 'internal-moodboard').decision).toBe('needs-review')
  })

  it('P0 jurisdiction: declared source jurisdiction differing from userJurisdiction → needs-review', () => {
    const v = evaluateUse(rec('PD', { jurisdiction: 'US' }), 'commercial-product', { userJurisdiction: 'DE' })
    expect(v.decision).toBe('needs-review')
  })

  // P0 DONE-CRITERION: no commercial/AI intent ever returns allowed* unless commercialUse===true
  it('strict-deny invariant: false-positive rate is 0 across the license table', () => {
    const commercial = new Set(
      Object.entries(LICENSE_FACTS)
        .filter(([, f]) => f.commercialUse === true)
        .map(([id]) => id)
    )
    const licenses: LicenseId[] = [
      'CC0-1.0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND',
      'PD', 'unsplash', 'pexels', 'pixabay', 'proprietary', 'unknown',
    ]
    for (const license of licenses) {
      for (const intent of ['commercial-product', 'ai-generation-input'] as const) {
        const v = evaluateUse(rec(license), intent)
        if (v.decision === 'allowed' || v.decision === 'allowed-with-attribution') {
          // it is a positive — assert it is a TRUE positive
          expect(commercial.has(license)).toBe(true)
        }
      }
    }
  })

  it('CC-BY-NC: commercial denied with the REAL license named, moodboard allowed, redistribution needs-review', () => {
    const commercial = evaluateUse(rec('CC-BY-NC'), 'commercial-product')
    expect(commercial.decision).toBe('denied')
    expect(commercial.reasons.join(' ')).toContain('CC-BY-NC') // not "proprietary"
    expect(evaluateUse(rec('CC-BY-NC'), 'ai-generation-input').decision).toBe('denied')
    expect(evaluateUse(rec('CC-BY-NC'), 'internal-moodboard').decision).toBe('allowed')
    expect(evaluateUse(rec('CC-BY-NC'), 'redistribution').decision).toBe('needs-review')
  })

  it('CC-BY-ND: verbatim commercial allowed-with-attribution, AI-generation denied (derivatives)', () => {
    expect(evaluateUse(rec('CC-BY-ND'), 'commercial-product').decision).toBe('allowed-with-attribution')
    expect(evaluateUse(rec('CC-BY-ND'), 'ai-generation-input').decision).toBe('denied')
    expect(evaluateUse(rec('CC-BY-ND'), 'redistribution').decision).toBe('allowed-with-attribution')
  })
})

describe('evaluatePermissions — programmable strict-deny gate', () => {
  it('custom permission set: derivatives-only on CC-BY-ND → denied, naming CC-BY-ND', () => {
    const v = evaluatePermissions(rec('CC-BY-ND'), ['derivatives'])
    expect(v.decision).toBe('denied')
    expect(v.reasons.join(' ')).toContain('CC-BY-ND')
  })

  it('empty required set on CC-BY with enforceAttribution (default true) → allowed-with-attribution', () => {
    const v = evaluatePermissions(rec('CC-BY'), [])
    expect(v.decision).toBe('allowed-with-attribution')
  })

  it('unknown license → needs-review regardless of required permissions', () => {
    const v = evaluatePermissions(rec('unknown'), ['commercialUse', 'derivatives', 'redistribution'])
    expect(v.decision).toBe('needs-review')
    expect(v.confidence).toBe('low')
  })

  it('preset parity: evaluatePermissions(rec, [commercialUse], undefined, {denyEditorialOnly:true, label}) equals evaluateUse(rec, commercial-product)', () => {
    const licenses: LicenseId[] = ['CC0-1.0', 'CC-BY', 'CC-BY-NC', 'CC-BY-ND', 'proprietary', 'unknown']
    for (const license of licenses) {
      const viaPermissions = evaluatePermissions(rec(license), ['commercialUse'], undefined, { denyEditorialOnly: true, label: 'commercial-product' })
      const viaUse = evaluateUse(rec(license), 'commercial-product')
      expect(viaPermissions.decision).toBe(viaUse.decision)
      expect(viaPermissions.reasons).toEqual(viaUse.reasons)
    }
  })

  it('evaluateUse success reasons name the intent (historical wording)', () => {
    expect(evaluateUse(rec('CC0-1.0'), 'commercial-product').reasons).toContain('permitted for commercial-product under CC0-1.0')
    expect(evaluateUse(rec('CC0-1.0'), 'internal-moodboard').reasons).toContain('permitted for internal-moodboard under CC0-1.0')
  })

  it('standalone evaluatePermissions defaults the label to the permission set', () => {
    expect(evaluatePermissions(rec('CC0-1.0'), ['commercialUse']).reasons).toContain('permitted for commercialUse under CC0-1.0')
  })

  it('lenient-attribution note interpolates the custom label', () => {
    const v = evaluatePermissions(rec('CC-BY'), [], undefined, { enforceAttribution: false, label: 'archival-review' })
    expect(v.reasons.some(r => r.includes('not enforced for archival-review use'))).toBe(true)
  })
})
