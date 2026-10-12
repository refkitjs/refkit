import { describe, expect, it } from 'vitest'
import { createRefkit } from '@refkit/core'
import { gutendex } from '../index'
import { poetrydb } from '@refkit/provider-poetrydb'

const GUTENDEX = { count: 2, next: null, previous: null, results: [
  { id: 1400, title: 'Great Expectations', authors: [{ name: 'Dickens, Charles', birth_year: 1812, death_year: 1870 }], summaries: ['A synopsis.'], subjects: [], languages: ['en'], copyright: false, media_type: 'Text', formats: {} },
  { id: 99999, title: 'Copyrighted Modern Book', authors: [{ name: 'Doe, Jane', birth_year: 1950, death_year: null }], summaries: [], subjects: [], languages: ['en'], copyright: true, media_type: 'Text', formats: {} },
] }
const POETRYDB = [
  { title: 'Ozymandias', author: 'Percy Bysshe Shelley', lines: ['I met a traveller from an antique land', 'Who said: ...'], linecount: '14' },
]

const routedFetch = (async (input: Parameters<typeof fetch>[0]) => {
  const u = String(input)
  const body = u.includes('gutendex') ? GUTENDEX : POETRYDB
  return new Response(JSON.stringify(body), { status: 200 })
}) as typeof fetch

describe('P2 integration: createRefkit + gutendex + poetrydb (offline)', () => {
  it('merges text references across both sources', async () => {
    const rk = createRefkit({ providers: [gutendex(), poetrydb()], fetch: routedFetch })
    const refs = await rk.search({ query: 'great', modalities: ['text'] })
    const sources = new Set(refs.map(r => r.source.id))
    expect(sources.has('gutendex')).toBe(true)
    expect(sources.has('poetrydb')).toBe(true)
    expect(refs.every(r => r.modality === 'text')).toBe(true)
  })

  it('gateFor commercial-product drops the copyright:true Gutenberg book', async () => {
    const rk = createRefkit({ providers: [gutendex(), poetrydb()], fetch: routedFetch })
    const refs = await rk.search({ query: 'great', modalities: ['text'], gateFor: 'commercial-product' })
    const titles = refs.map(r => r.title)
    expect(titles).toContain('Great Expectations') // PD → allowed
    expect(titles).toContain('Ozymandias')          // PD → allowed
    expect(titles).not.toContain('Copyrighted Modern Book') // proprietary → denied
  })
})
