import { describe, expect, it } from 'vitest'
import { normalizeQuery } from '../query'
import type { ReferenceProvider } from '../provider'

const provider = (
  qf: ReferenceProvider['queryFeatures'],
  modalities: ReferenceProvider['modalities'] = ['image'],
): ReferenceProvider => ({ id: 'p', modalities, queryFeatures: qf, search: async () => [] })

describe('normalizeQuery', () => {
  it('drops filters the provider does not support', () => {
    const nq = normalizeQuery(
      { query: 'cat', modalities: ['image'], filters: { color: 'red', orientation: 'landscape' } },
      provider(['keyword', 'color']),
    )
    expect(nq.filters).toEqual({ color: 'red' }) // orientation dropped
  })

  it('omits filters entirely when none survive', () => {
    const nq = normalizeQuery(
      { query: 'cat', modalities: ['image'], filters: { color: 'red' } },
      provider(['keyword']),
    )
    expect(nq.filters).toBeUndefined()
  })

  it('intersects modalities with the provider', () => {
    const nq = normalizeQuery({ query: 'x', modalities: ['image', 'text'] }, provider(['keyword'], ['image']))
    expect(nq.modalities).toEqual(['image'])
  })

  it('passes through query text and limit', () => {
    const nq = normalizeQuery({ query: 'cat', modalities: ['image'], limit: 10 }, provider(['keyword']))
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
      provider(['keyword']),
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
