import { describe, expect, it } from 'vitest'
import { fnv1a } from '../hash'
import { canonicalizeUrl, referenceId } from '../dedup-key'

describe('fnv1a', () => {
  it('is deterministic and base36', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).toMatch(/^[0-9a-z]+$/)
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
  })
})

describe('canonicalizeUrl', () => {
  it('lowercases scheme+host, drops fragment and trailing slash', () => {
    expect(canonicalizeUrl('HTTPS://Example.ORG/Photo/1/#frag')).toBe('https://example.org/Photo/1')
  })

  it('preserves path case and query', () => {
    expect(canonicalizeUrl('https://example.org/a/B?q=1')).toBe('https://example.org/a/B?q=1')
  })

  it('returns the raw string unchanged when not a valid URL', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url')
  })
})

describe('referenceId', () => {
  it('is stable for the same source id + sourceUrl', () => {
    expect(referenceId('unsplash', 'https://x/1')).toBe(referenceId('unsplash', 'https://x/1'))
  })

  it('differs across providers', () => {
    expect(referenceId('unsplash', 'https://x/1')).not.toBe(referenceId('pexels', 'https://x/1'))
  })
})
