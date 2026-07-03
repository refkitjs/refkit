import { describe, expect, it } from 'vitest'
import { LICENSE_FACTS, factsFor, type LicenseId } from '../license'

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
    expect(factsFor('not-a-real-license' as LicenseId)).toBe(LICENSE_FACTS.unknown)
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
  })
})
