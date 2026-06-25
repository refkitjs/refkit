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
})
