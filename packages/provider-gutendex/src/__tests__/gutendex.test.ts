import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { gutendex, copyrightToLicense } from '../index'

const FIXTURE = {
  count: 3, next: null, previous: null,
  results: [
    {
      id: 1400, title: 'Great Expectations',
      authors: [{ name: 'Dickens, Charles', birth_year: 1812, death_year: 1870 }],
      summaries: ['"Great Expectations" by Charles Dickens is a novel first published serially from 1860 to 1861.'],
      subjects: ['Orphans -- Fiction'], languages: ['en'],
      copyright: false, media_type: 'Text',
      formats: {
        'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/1400.txt.utf-8',
        'image/jpeg': 'https://www.gutenberg.org/cache/epub/1400/pg1400.cover.medium.jpg',
      },
      download_count: 26548,
    },
    {
      id: 99999, title: 'A Modern Copyrighted Translation',
      authors: [{ name: 'Doe, Jane', birth_year: 1950, death_year: null }],
      summaries: [], subjects: [], languages: ['en'],
      copyright: true, media_type: 'Text',
      formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/99999.txt.utf-8' },
      download_count: 5,
    },
    {
      id: 8608, title: 'Great Expectations (audiobook)',
      authors: [{ name: 'Dickens, Charles', birth_year: 1812, death_year: 1870 }],
      summaries: [], subjects: [], languages: ['en'],
      copyright: true, media_type: 'Sound',
      formats: { 'audio/mpeg': 'https://www.gutenberg.org/files/8608/mp3/8608-000.mp3' },
      download_count: 4330,
    },
  ],
}
const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

describe('copyrightToLicense', () => {
  it('maps the per-item copyright boolean', () => {
    expect(copyrightToLicense(false)).toBe('PD')
    expect(copyrightToLicense(true)).toBe('proprietary')
    expect(copyrightToLicense(null)).toBe('unknown')
  })
})

describe('gutendex provider', () => {
  it('maps unified text controls to Gutendex search params', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await gutendex().search({
      text: 'great',
      modalities: ['text'],
      controls: { language: 'en', text: { copyright: 'public-domain' }, page: 2 },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('languages')).toBe('en')
    expect(url.searchParams.get('copyright')).toBe('false')
    expect(url.searchParams.get('page')).toBe('2')
  })

  it('forwards documented Gutendex search options', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await gutendex().search({
      text: 'great',
      modalities: ['text'],
      providerOptions: {
        authorYearStart: 1800,
        authorYearEnd: 1899,
        copyright: ['false', 'null'],
        ids: ['1400', '84'],
        languages: ['en', 'fr'],
        mimeType: 'text/html',
        sort: 'ascending',
        topic: 'children',
        page: 4,
      },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('author_year_start')).toBe('1800')
    expect(url.searchParams.get('author_year_end')).toBe('1899')
    expect(url.searchParams.get('copyright')).toBe('false,null')
    expect(url.searchParams.get('ids')).toBe('1400,84')
    expect(url.searchParams.get('languages')).toBe('en,fr')
    expect(url.searchParams.get('mime_type')).toBe('text/html')
    expect(url.searchParams.get('sort')).toBe('ascending')
    expect(url.searchParams.get('topic')).toBe('children')
    expect(url.searchParams.get('page')).toBe('4')
  })

  it('filters non-Text media and maps the rest to text References', async () => {
    const refs = await gutendex().search({ text: 'great expectations', modalities: ['text'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(2) // the Sound record is filtered out
    const pd = refs[0]
    expect(pd.modality).toBe('text')
    expect(pd.rights.license).toBe('PD')
    expect(pd.title).toBe('Great Expectations')
    expect(pd.rights.author).toBe('Dickens, Charles')
    expect(pd.canonicalUrl).toBe('https://www.gutenberg.org/ebooks/1400')
    expect(pd.thumbnail?.url).toBe('https://www.gutenberg.org/cache/epub/1400/pg1400.cover.medium.jpg')
    expect(pd.text?.excerpt).toContain('Great Expectations')
    expect(pd.text?.excerptKind).toBe('structure') // summaries[0] is a synopsis, not a verbatim passage
  })

  it('TEXT-SIDE moat: a copyright:true Gutenberg record → proprietary → denied for commercial use', async () => {
    const refs = await gutendex().search({ text: 'x', modalities: ['text'] }, ctxWith(FIXTURE))
    const copyrighted = refs.find(r => r.title?.includes('Modern'))!
    expect(copyrighted.rights.license).toBe('proprietary')
    expect(evaluateUse(copyrighted.rights, 'commercial-product').decision).toBe('denied')
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('allowed') // the PD book
  })

  it('omits the text field when there is no summary (no second fetch)', async () => {
    const refs = await gutendex().search({ text: 'x', modalities: ['text'] }, ctxWith(FIXTURE))
    const noSummary = refs.find(r => r.title?.includes('Modern'))!
    expect(noSummary.text).toBeUndefined()
  })

  it('copyright:null → unknown license → needs-review for commercial use (undetermined copyright, never auto-allowed)', async () => {
    const nullCopyrightFixture = {
      count: 1, next: null, previous: null,
      results: [
        {
          id: 55555, title: 'Unknown Copyright Work',
          authors: [{ name: 'Unknown, Author', birth_year: null, death_year: null }],
          summaries: [], subjects: [], languages: ['en'],
          copyright: null, media_type: 'Text',
          formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/55555.txt.utf-8' },
          download_count: 1,
        },
      ],
    }
    const refs = await gutendex().search({ text: 'x', modalities: ['text'] }, ctxWith(nullCopyrightFixture))
    expect(refs).toHaveLength(1)
    const result = refs[0]
    expect(result.rights.license).toBe('unknown')
    expect(evaluateUse(result.rights, 'commercial-product').decision).toBe('needs-review')
  })
})
