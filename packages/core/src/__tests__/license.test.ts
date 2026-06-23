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
})
