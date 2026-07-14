import { describe, expect, it } from 'vitest'
import { normalizeQuery } from '../query'
import type { ReferenceProvider } from '../provider'

const provider = (
  controls: NonNullable<ReferenceProvider['capabilities']>['controls'] = [],
  modalities: ReferenceProvider['modalities'] = ['image'],
): ReferenceProvider => ({ id: 'p', modalities, capabilities: { controls }, search: async () => [] })

describe('normalizeQuery', () => {
  it('routes legacy filters by capabilities.controls and mirrors them on both channels', () => {
    const nq = normalizeQuery(
      { query: 'cat', modalities: ['image'], filters: { color: 'red', orientation: 'landscape' } },
      provider(['color']),
    )
    expect(nq.filters).toEqual({ color: 'red' }) // orientation dropped (not in capabilities)
    expect(nq.controls).toEqual({ color: 'red' }) // derived channel stays consistent
  })

  it('legacy compat: a capabilities-less provider declaring only queryFeatures still receives its filters', () => {
    const legacy: ReferenceProvider = {
      id: 'p',
      modalities: ['image'],
      queryFeatures: ['keyword', 'orientation'], // pre-capabilities third-party shape
      search: async () => [],
    }
    const nq = normalizeQuery(
      { query: 'cat', modalities: ['image'], filters: { orientation: 'landscape', color: 'red' } },
      legacy,
    )
    expect(nq.filters).toEqual({ orientation: 'landscape' }) // color not declared → dropped
    expect(nq.controls).toEqual({ orientation: 'landscape' })
  })

  it('capabilities, once declared, win over queryFeatures', () => {
    const both: ReferenceProvider = {
      id: 'p',
      modalities: ['image'],
      queryFeatures: ['keyword', 'orientation'],
      capabilities: { controls: [] }, // explicit: supports nothing
      search: async () => [],
    }
    const nq = normalizeQuery(
      { query: 'cat', modalities: ['image'], filters: { orientation: 'landscape' } },
      both,
    )
    expect(nq.filters).toBeUndefined()
    expect(nq.controls).toBeUndefined()
  })

  it('omits filters entirely when none survive', () => {
    const nq = normalizeQuery(
      { query: 'cat', modalities: ['image'], filters: { color: 'red' } },
      provider([]),
    )
    expect(nq.filters).toBeUndefined()
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
      queryFeatures: ['keyword'],
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

  it('maps legacy filters into controls for compatibility', () => {
    const p: ReferenceProvider = {
      id: 'p',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      capabilities: { controls: ['orientation', 'color', 'language'] },
      search: async () => [],
    }
    const nq = normalizeQuery(
      {
        query: 'cat',
        modalities: ['image'],
        filters: { orientation: 'portrait', color: 'red', language: 'en-US' },
      },
      p,
    )
    expect(nq.controls).toEqual({ orientation: 'portrait', color: 'red', language: 'en-US' })
  })

  it('prefers primary controls over conflicting legacy filters when normalizing controls', () => {
    const p: ReferenceProvider = {
      id: 'p',
      modalities: ['image'],
      queryFeatures: ['keyword'],
      capabilities: { controls: ['orientation', 'color', 'language'] },
      search: async () => [],
    }
    const nq = normalizeQuery(
      {
        query: 'cat',
        modalities: ['image'],
        filters: { orientation: 'portrait', color: 'red', language: 'en-US' },
        controls: { orientation: 'landscape', color: 'blue', language: 'fr' },
      },
      p,
    )
    expect(nq.controls).toEqual({ orientation: 'landscape', color: 'blue', language: 'fr' })
  })
})
