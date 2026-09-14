import { describe, expect, it } from 'vitest'
import {
  LICENSE_FACTS, ccVersionFor, compareRestrictiveness, factsFor, isIndeterminate, isKnownLicenseId,
  permissivenessScore,
} from '../license'

describe('LICENSE_FACTS', () => {
  it('CC0 allows commercial use, derivatives, redistribution, no attribution, no share-alike', () => {
    expect(LICENSE_FACTS['CC0-1.0']).toEqual({
      commercialUse: true,
      derivatives: true,
      redistribution: true,
      attributionRequired: false,
      shareAlike: false,
    })
  })

  it('CC-BY-SA is copyleft (shareAlike) and requires attribution', () => {
    expect(LICENSE_FACTS['CC-BY-SA'].shareAlike).toBe(true)
    expect(LICENSE_FACTS['CC-BY-SA'].attributionRequired).toBe(true)
    expect(LICENSE_FACTS['CC-BY-SA'].commercialUse).toBe(true)
  })

  it('unknown license is unknown on every permission (drives strict-deny)', () => {
    expect(LICENSE_FACTS.unknown).toEqual({
      commercialUse: 'unknown',
      derivatives: 'unknown',
      redistribution: 'unknown',
      attributionRequired: false,
      shareAlike: false,
    })
  })

  it('proprietary denies derivatives and redistribution', () => {
    expect(LICENSE_FACTS.proprietary.derivatives).toBe(false)
    expect(LICENSE_FACTS.proprietary.redistribution).toBe(false)
  })

  it('factsFor falls back to unknown for an unrecognized id', () => {
    expect(factsFor('not-a-real-license')).toBe(LICENSE_FACTS.unknown)
  })

  it('CC-BY-ND allows verbatim commercial use but no derivatives', () => {
    expect(LICENSE_FACTS['CC-BY-ND']).toEqual({
      commercialUse: true,
      derivatives: false,
      redistribution: true,
      attributionRequired: true,
      shareAlike: false,
    })
  })

  it('CC-BY-NC family: commercial false, redistribution unknown (intent cannot model NC-only sharing)', () => {
    for (const id of ['CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND'] as const) {
      expect(LICENSE_FACTS[id].commercialUse).toBe(false)
      expect(LICENSE_FACTS[id].redistribution).toBe('unknown')
      expect(LICENSE_FACTS[id].attributionRequired).toBe(true)
    }
    expect(LICENSE_FACTS['CC-BY-NC'].derivatives).toBe(true)
    expect(LICENSE_FACTS['CC-BY-NC-SA'].derivatives).toBe(true)
    expect(LICENSE_FACTS['CC-BY-NC-SA'].shareAlike).toBe(true)
    expect(LICENSE_FACTS['CC-BY-NC-ND'].derivatives).toBe(false)
    expect(LICENSE_FACTS['CC-BY-NC'].shareAlike).toBe(false)
    expect(LICENSE_FACTS['CC-BY-NC-ND'].shareAlike).toBe(false)
  })
})

describe('facts API', () => {
  it('factsFor falls back to unknown for an id outside the table', () => {
    expect(factsFor('acme-stock')).toEqual(LICENSE_FACTS.unknown)
    expect(isKnownLicenseId('acme-stock')).toBe(false)
    expect(isKnownLicenseId('CC-BY')).toBe(true)
  })
  it('isIndeterminate is true only when all three tri axes are unknown', () => {
    expect(isIndeterminate(LICENSE_FACTS.unknown)).toBe(true)
    expect(isIndeterminate(LICENSE_FACTS['CC-BY-NC'])).toBe(false)
  })
  it('compareRestrictiveness orders by dominance and reports incomparable pairs', () => {
    expect(compareRestrictiveness(LICENSE_FACTS['CC-BY'], LICENSE_FACTS['CC0-1.0'])).toBe('a')
    expect(compareRestrictiveness(LICENSE_FACTS['CC0-1.0'], LICENSE_FACTS['CC-BY'])).toBe('b')
    expect(compareRestrictiveness(LICENSE_FACTS['CC0-1.0'], LICENSE_FACTS.PD)).toBe('equal')
    // unsplash forbids redistribution but needs no attribution; CC-BY is the reverse
    expect(compareRestrictiveness(LICENSE_FACTS.unsplash, LICENSE_FACTS['CC-BY'])).toBe('incomparable')
  })
  it('permissivenessScore is 1 for CC0 and treats unknown as not granted', () => {
    expect(permissivenessScore(LICENSE_FACTS['CC0-1.0'])).toBe(1)
    expect(permissivenessScore(LICENSE_FACTS['CC-BY'])).toBe(0.875)
    expect(permissivenessScore(LICENSE_FACTS.unknown)).toBe(0.25)
    expect(permissivenessScore(LICENSE_FACTS['CC-BY-NC-ND'])).toBe(0.125)
  })
  it('ccVersionFor: version rides only on versioned CC families', () => {
    expect(ccVersionFor('CC-BY-NC', '2.0')).toBe('2.0')
    expect(ccVersionFor('CC-BY-ND', '4.0')).toBe('4.0')
    expect(ccVersionFor('CC-BY', '4.0')).toBe('4.0')
    expect(ccVersionFor('CC0-1.0', '1.0')).toBeUndefined()
    expect(ccVersionFor('proprietary', '2.0')).toBeUndefined()
    expect(ccVersionFor('CC-BY-NC', undefined)).toBeUndefined()
  })
})
