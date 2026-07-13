import { describe, expect, it } from 'vitest'
import type { ProviderContext } from '@refkit/core'
import { poetrydb } from '../index'

const FIXTURE = [
  {
    title: 'Ozymandias', author: 'Percy Bysshe Shelley',
    lines: [
      'I met a traveller from an antique land',
      'Who said: Two vast and trunkless legs of stone',
      'Stand in the desert...Near them, on the sand,',
      'Half sunk, a shattered visage lies, whose frown,',
      'And wrinkled lip, and sneer of cold command,',
      'Tell that its sculptor well those passions read',
      'Which yet survive, stamped on these lifeless things,',
      'The hand that mocked them, and the heart that fed:',
      'And on the pedestal these words appear:',
      "'My name is Ozymandias, king of kings:'",
    ],
    linecount: '14',
  },
]
const ctxWith = (body: unknown, onFetch?: (url: string) => void): ProviderContext => ({
  fetch: (async (input: Parameters<typeof fetch>[0]) => {
    onFetch?.(String(input))
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch,
})

describe('poetrydb provider', () => {
  it('maps a poem to a full-text passage Reference (PD inferred)', async () => {
    const refs = await poetrydb().search({ text: 'Ozymandias', modalities: ['text'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('text')
    expect(r.rights.license).toBe('PD')
    expect(r.title).toBe('Ozymandias')
    expect(r.rights.author).toBe('Percy Bysshe Shelley')
    expect(r.id).toMatch(/^poetrydb:/)
    expect(r.text?.excerptKind).toBe('passage')
    expect(r.text?.excerpt.split('\n').length).toBe(8) // first 8 lines
    expect(r.text?.excerpt).toContain('I met a traveller')
    expect(r.canonicalUrl).toContain('poetrydb.org')
  })

  it('returns [] on a no-match {status:404} response (bare-array contract)', async () => {
    const refs = await poetrydb().search({ text: 'zzzznomatch', modalities: ['text'] }, ctxWith({ status: 404, reason: 'Not found' }))
    expect(refs).toEqual([])
  })

  it('maps q.limit to poemcount for the default line search', async () => {
    let calledUrl = ''
    await poetrydb().search({ text: 'love', modalities: ['text'], limit: 5 }, ctxWith([], url => { calledUrl = url }))
    expect(calledUrl).toBe('https://poetrydb.org/lines,poemcount/love;5')
  })

  it('preserves inputFields when searchTerms are omitted', async () => {
    let calledUrl = ''
    await poetrydb().search({
      text: 'love',
      modalities: ['text'],
      limit: 5,
      providerOptions: { inputFields: ['title'] },
    }, ctxWith([], url => { calledUrl = url }))
    expect(calledUrl).toBe('https://poetrydb.org/title,poemcount/love;5')
  })

  it('preserves searchTerms when inputFields are omitted', async () => {
    let calledUrl = ''
    await poetrydb().search({
      text: 'ignored',
      modalities: ['text'],
      limit: 5,
      providerOptions: { searchTerms: ['Winter'] },
    }, ctxWith([], url => { calledUrl = url }))
    expect(calledUrl).toBe('https://poetrydb.org/lines,poemcount/Winter;5')
  })

  it('prefers an explicit positive poemCount over q.limit', async () => {
    let calledUrl = ''
    await poetrydb().search({
      text: 'love',
      modalities: ['text'],
      limit: 5,
      providerOptions: { poemCount: 3 },
    }, ctxWith([], url => { calledUrl = url }))
    expect(calledUrl).toBe('https://poetrydb.org/lines,poemcount/love;3')
  })

  it('uses an explicit positive random instead of an implicit poemcount', async () => {
    let calledUrl = ''
    await poetrydb().search({
      text: 'love',
      modalities: ['text'],
      limit: 5,
      providerOptions: { random: 2 },
    }, ctxWith([], url => { calledUrl = url }))
    expect(calledUrl).toBe('https://poetrydb.org/lines,random/love;2')
  })

  it.each([
    ['poemCount', 0],
    ['poemCount', -1],
    ['poemCount', 1.5],
    ['random', 0],
    ['random', -1],
    ['random', 1.5],
  ] as const)('ignores invalid %s=%s and falls back to q.limit', async (option, value) => {
    let calledUrl = ''
    await poetrydb().search({
      text: 'love',
      modalities: ['text'],
      limit: 5,
      providerOptions: { [option]: value },
    }, ctxWith([], url => { calledUrl = url }))
    expect(calledUrl).toBe('https://poetrydb.org/lines,poemcount/love;5')
  })

  it('builds documented PoetryDB routes from providerOptions', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify(FIXTURE), { status: 200 })
      }) as typeof fetch,
    }
    await poetrydb().search({
      text: 'ignored',
      modalities: ['text'],
      limit: 5,
      providerOptions: {
        inputFields: ['title', 'author', 'poemcount'],
        searchTerms: ['Winter', 'William Shakespeare', '2'],
        matchExact: true,
        outputFields: ['author', 'title', 'linecount'],
      },
    }, ctx)
    expect(calledUrl).toBe('https://poetrydb.org/title,author,poemcount/Winter;William%20Shakespeare;2:abs/author,title,lines,linecount')
  })
})
