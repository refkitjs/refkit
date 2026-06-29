import { describe, expect, it } from 'vitest'
import {
  setIfString, setIfBoolean, setIfStringList,
  setIfInt, setIfPositiveInt, setIfNonNegativeInt, setIfNumber,
  first, mapCcDeedUrl, mapRightsUrl, isLikelyImageUrl, imageMediaType,
} from '../provider-helpers'

const params = (fn: (u: URL) => void) => { const u = new URL('https://x.test/'); fn(u); return u.searchParams }

describe('setIfString', () => {
  it('sets a non-empty string; skips non-strings and empty', () => {
    expect(params(u => setIfString(u, 'a', 'x')).get('a')).toBe('x')
    expect(params(u => setIfString(u, 'a', '')).get('a')).toBeNull()
    expect(params(u => setIfString(u, 'a', 5)).get('a')).toBeNull()
  })
  it('honors an allowlist', () => {
    expect(params(u => setIfString(u, 'a', 'no', ['yes'])).get('a')).toBeNull()
    expect(params(u => setIfString(u, 'a', 'yes', ['yes'])).get('a')).toBe('yes')
  })
})

describe('setIfBoolean', () => {
  it('encodes as true/false strings; skips non-booleans', () => {
    expect(params(u => setIfBoolean(u, 'b', true)).get('b')).toBe('true')
    expect(params(u => setIfBoolean(u, 'b', false)).get('b')).toBe('false')
    expect(params(u => setIfBoolean(u, 'b', 'true')).get('b')).toBeNull()
  })
})

describe('setIfStringList', () => {
  it('joins arrays (default comma), accepts a string, supports a custom separator + allowlist', () => {
    expect(params(u => setIfStringList(u, 't', ['a', 'b'])).get('t')).toBe('a,b')
    expect(params(u => setIfStringList(u, 't', 'solo')).get('t')).toBe('solo')
    expect(params(u => setIfStringList(u, 't', ['a', 'b'], { separator: ' ' })).get('t')).toBe('a b')
    expect(params(u => setIfStringList(u, 't', ['a', 'x'], { allowed: ['a', 'b'] })).get('t')).toBeNull()
    expect(params(u => setIfStringList(u, 't', [])).get('t')).toBeNull()
  })
})

describe('int/number setters', () => {
  it('setIfInt respects min/max and integer-ness', () => {
    expect(params(u => setIfInt(u, 'n', 5)).get('n')).toBe('5')
    expect(params(u => setIfInt(u, 'n', 5.5)).get('n')).toBeNull()
    expect(params(u => setIfInt(u, 'n', 0, { min: 1 })).get('n')).toBeNull()
    expect(params(u => setIfInt(u, 'n', 999, { max: 100 })).get('n')).toBeNull()
  })
  it('setIfPositiveInt defaults to min 1; setIfNonNegativeInt to min 0', () => {
    expect(params(u => setIfPositiveInt(u, 'p', 0)).get('p')).toBeNull()
    expect(params(u => setIfPositiveInt(u, 'p', 1)).get('p')).toBe('1')
    expect(params(u => setIfPositiveInt(u, 'p', 999, { max: 500 })).get('p')).toBeNull()
    expect(params(u => setIfNonNegativeInt(u, 'q', 0)).get('q')).toBe('0')
    expect(params(u => setIfNonNegativeInt(u, 'q', -1)).get('q')).toBeNull()
  })
  it('clamp:true clamps to max instead of rejecting (preserves provider Math.min behavior)', () => {
    expect(params(u => setIfInt(u, 'n', 999, { max: 100, clamp: true })).get('n')).toBe('100')
    expect(params(u => setIfPositiveInt(u, 'p', 999, { max: 500, clamp: true })).get('p')).toBe('500')
    expect(params(u => setIfPositiveInt(u, 'p', 0, { max: 500, clamp: true })).get('p')).toBeNull() // min floor still rejects
    expect(params(u => setIfNonNegativeInt(u, 'q', 999, { max: 200, clamp: true })).get('q')).toBe('200')
  })
  it('setIfNumber allows non-integers', () => {
    expect(params(u => setIfNumber(u, 'f', 1.5, { min: 0, max: 10 })).get('f')).toBe('1.5')
    expect(params(u => setIfNumber(u, 'f', 20, { max: 10 })).get('f')).toBeNull()
  })
})

describe('first', () => {
  it('returns the first element or undefined', () => {
    expect(first(['a', 'b'])).toBe('a')
    expect(first([])).toBeUndefined()
    expect(first(undefined)).toBeUndefined()
  })
})

describe('mapCcDeedUrl', () => {
  it('maps PD/CC0, BY/BY-SA (+version), NC/ND → proprietary, else unknown', () => {
    expect(mapCcDeedUrl('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
    expect(mapCcDeedUrl('https://creativecommons.org/publicdomain/mark/1.0/')).toEqual({ license: 'PD' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-sa/3.0/')).toEqual({ license: 'CC-BY-SA', version: '3.0' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toEqual({ license: 'proprietary' })
    expect(mapCcDeedUrl('http://creativecommons.org/licenses/by-nd/4.0/')).toEqual({ license: 'proprietary' })
    // mapCcDeedUrl is CC-only — a rightsstatements URL has no CC pattern → unknown here
    // (the faithful rightsstatements mapping lives in mapRightsUrl, tested below).
    expect(mapCcDeedUrl('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'unknown' })
    expect(mapCcDeedUrl(undefined)).toEqual({ license: 'unknown' })
    expect(mapCcDeedUrl('https://example.org/x')).toEqual({ license: 'unknown' })
  })
  it('never throws on a non-string input (array/number) → unknown', () => {
    expect(mapCcDeedUrl(['x'] as any)).toEqual({ license: 'unknown' })
  })
})

describe('mapRightsUrl (CC deeds + faithful rightsstatements.org)', () => {
  it('delegates CC deeds to mapCcDeedUrl', () => {
    expect(mapRightsUrl('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'CC-BY', version: '4.0' })
    expect(mapRightsUrl('http://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ license: 'CC0-1.0' })
  })
  it('maps rightsstatements faithfully: InC→proprietary, NoC-US→PD+US, NoC-NC→proprietary', () => {
    expect(mapRightsUrl('http://rightsstatements.org/vocab/InC/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/InC-OW-EU/1.0/')).toEqual({ license: 'proprietary' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-US/1.0/')).toEqual({ license: 'PD', jurisdiction: 'US' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-NC/1.0/')).toEqual({ license: 'proprietary' })
  })
  it('maps opaque/undetermined rightsstatements → unknown', () => {
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-OKLR/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NoC-CR/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/CNE/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/UND/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl('http://rightsstatements.org/vocab/NKC/1.0/')).toEqual({ license: 'unknown' })
    expect(mapRightsUrl(undefined)).toEqual({ license: 'unknown' })
  })
  it('never throws on a non-string input (number) → unknown', () => {
    expect(mapRightsUrl(123 as any)).toEqual({ license: 'unknown' })
  })
})

describe('image helpers', () => {
  it('isLikelyImageUrl: extension / iiif / thumbnail / image CDN', () => {
    expect(isLikelyImageUrl('https://x/y.jpg')).toBe(true)
    expect(isLikelyImageUrl('https://iiif.x/a/full/full/0/default.jpg')).toBe(true)
    expect(isLikelyImageUrl('https://api.europeana.eu/thumbnail/v3/200/a.jpg')).toBe(true)
    expect(isLikelyImageUrl('https://lh3.googleusercontent.com/abc=s0')).toBe(true)
    expect(isLikelyImageUrl('https://www.rijksmuseum.nl/en/collection/SK-A-1')).toBe(false)
  })
  it('imageMediaType: MIME wins, else extension, else default', () => {
    expect(imageMediaType('image/png', 'https://x/y')).toBe('image/png')
    expect(imageMediaType(undefined, 'https://x/y.png')).toBe('image/png')
    expect(imageMediaType(undefined, 'https://x/y.jpg')).toBe('image/jpeg')
    expect(imageMediaType('application/octet-stream', 'https://x/y')).toBe('image/jpeg')
  })
})
