import { describe, expect, it } from 'vitest'
import { normalizeQuery } from '../query'
import { defineProvider, type ReferenceProvider } from '../provider'

const provider = (
  controls: NonNullable<ReferenceProvider['capabilities']>['controls'] = [],
  modalities: ReferenceProvider['modalities'] = ['image'],
): ReferenceProvider => ({ id: 'p', modalities, capabilities: { controls }, search: async () => [] })

describe('normalizeQuery', () => {
  it('routes only the controls a provider declares in capabilities.controls; a provider without capabilities gets none', () => {
    const p = defineProvider({ id: 'p', modalities: ['image'], capabilities: { controls: ['color'] }, search: async () => [] })
    const q = normalizeQuery({ query: 'x', modalities: ['image'], controls: { color: 'red', orientation: 'landscape' } }, p)
    expect(q.controls).toEqual({ color: 'red' })
    expect('filters' in q).toBe(false)
    const bare = defineProvider({ id: 'b', modalities: ['image'], search: async () => [] })
    expect(normalizeQuery({ query: 'x', modalities: ['image'], controls: { color: 'red' } }, bare).controls).toBeUndefined()
  })

  it('omits controls entirely when none survive', () => {
    const nq = normalizeQuery(
      { query: 'cat', modalities: ['image'], controls: { color: 'red' } },
      provider([]),
    )
    expect(nq.controls).toBeUndefined()
  })

  it('intersects modalities with the provider', () => {
    const nq = normalizeQuery({ query: 'x', modalities: ['image', 'text'] }, provider([], ['image']))
    expect(nq.modalities).toEqual(['image'])
  })

  it('passes through query text and limit', () => {
    const nq = normalizeQuery({ query: 'cat', modalities: ['image'], limit: 10 }, provider())
    expect(nq.text).toBe('cat')
    expect(nq.limit).toBe(10)
  })

  it('passes only the matching providerOptions entry to the provider query', () => {
    const nq = normalizeQuery(
      {
        query: 'cat',
        modalities: ['image'],
        providerOptions: {
          p: { orderBy: 'latest' },
          other: { orderBy: 'relevant' },
        },
      },
      provider(),
    )
    expect(nq.providerOptions).toEqual({ orderBy: 'latest' })
  })

  it('passes only provider-supported controls to the provider query', () => {
    const p: ReferenceProvider = {
      id: 'p',
      modalities: ['image'],
      capabilities: { controls: ['orientation', 'media.minWidth'] },
      search: async () => [],
    }
    const nq = normalizeQuery(
      {
        query: 'cat',
        modalities: ['image'],
        controls: {
          orientation: 'landscape',
          color: 'blue',
          media: { minWidth: 1200, minHeight: 800 },
        },
      },
      p,
    )
    expect(nq.controls).toEqual({ orientation: 'landscape', media: { minWidth: 1200 } })
  })

  it('routes every declared control family into the provider query', () => {
    const p: ReferenceProvider = {
      id: 'p',
      modalities: ['image'],
      capabilities: { controls: ['orientation', 'color', 'language'] },
      search: async () => [],
    }
    const nq = normalizeQuery(
      {
        query: 'cat',
        modalities: ['image'],
        controls: { orientation: 'portrait', color: 'red', language: 'en-US' },
      },
      p,
    )
    expect(nq.controls).toEqual({ orientation: 'portrait', color: 'red', language: 'en-US' })
  })
})
