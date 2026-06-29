import { describe, expect, it } from 'vitest'
import { mapEuropeanaRights } from '../index'

describe('mapEuropeanaRights', () => {
  it('maps CC0 and Public Domain Mark to open licenses (no version)', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapEuropeanaRights('http://creativecommons.org/publicdomain/mark/1.0/')).toEqual({ license: 'PD' })
  })

  it('maps CC-BY / CC-BY-SA and captures the version', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapEuropeanaRights('https://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
  })

  it('maps NC / ND variants to proprietary (not an open grant)', () => {
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc/4.0/')).toEqual({ license: 'proprietary' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nc-sa/4.0/')).toEqual({ license: 'proprietary' })
    expect(mapEuropeanaRights('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'proprietary' })
  })

  it('maps rightsstatements.org faithfully: InC→proprietary, NoC-US→PD+US, NoC-NC→proprietary', () => {
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-US/1.0/')).toEqual({ license: 'PD', jurisdiction: 'US' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-NC/1.0/')).toEqual({ license: 'proprietary' })
  })

  it('maps opaque/undetermined rightsstatements + empty/unrecognized to unknown', () => {
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/NoC-OKLR/1.0/')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('http://rightsstatements.org/vocab/CNE/1.0/')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('')).toEqual({ license: 'unknown' })
    expect(mapEuropeanaRights('http://example.org/some-other-license')).toEqual({ license: 'unknown' })
  })
})
