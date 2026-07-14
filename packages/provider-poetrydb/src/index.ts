import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

interface PoetryDbPoem { title: string; author: string; lines: string[]; linecount: string }

export interface PoetryDbSearchOptions {
  inputFields?: string | readonly string[]
  searchTerms?: string | readonly string[]
  matchExact?: boolean
  outputFields?: string | readonly string[]
  poemCount?: number
  random?: number
}

const EXCERPT_LINES = 8

function toReference(p: PoetryDbPoem): Reference {
  // PoetryDB has no human-facing HTML page or per-item id; this constructed API URL (returns JSON) is the best stable provenance anchor it offers.
  const canonicalUrl = `https://poetrydb.org/author,title/${encodeURIComponent(p.author)};${encodeURIComponent(p.title)}`
  const rights: RightsRecord = {
    // Project-level inference: PoetryDB curates classic (out-of-copyright) poets; it asserts
    // no per-item license. PD is inferred from editorial scope, not guaranteed per item.
    license: 'PD',
    author: p.author,
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://poetrydb.org', sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('poetrydb', `${p.author}:${p.title}`),
    modality: 'text',
    title: p.title,
    source: { providerId: 'poetrydb', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    text: {
      excerpt: p.lines.slice(0, EXCERPT_LINES).join('\n'), // representative excerpt, not the whole poem
      excerptKind: 'passage',
      locator: canonicalUrl,
    },
    relevance: 0,
    raw: p,
  }
}

function stringList(value: unknown, allowed: readonly string[]): string[] {
  if (typeof value === 'string' && allowed.includes(value)) return [value]
  if (Array.isArray(value) && value.every(v => typeof v === 'string' && allowed.includes(v))) return Array.from(value)
  return []
}

function searchTerms(value: unknown): string[] {
  if (typeof value === 'string' && value) return [value]
  if (Array.isArray(value) && value.every(v => typeof v === 'string' && v)) return Array.from(value)
  return []
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function poetrydbUrl(text: string, options: PoetryDbSearchOptions | undefined, limit: number | undefined): string {
  const allowedInput = ['author', 'title', 'lines', 'linecount', 'poemcount', 'random']
  let fields = stringList(options?.inputFields, allowedInput)
  let terms = searchTerms(options?.searchTerms)
  if (fields.length === 0) fields.push('lines')
  if (terms.length === 0) terms.push(text)
  if (fields.length !== terms.length) {
    fields = ['lines']
    terms = [text]
  }

  const explicitRandom = positiveInt(options?.random)
  const explicitCount = positiveInt(options?.poemCount)
  const implicitCount = positiveInt(limit)
  if (explicitRandom !== undefined && !fields.includes('random')) {
    fields.push('random')
    terms.push(String(explicitRandom))
  } else if (!fields.includes('random') && !fields.includes('poemcount')) {
    const count = explicitCount ?? implicitCount
    if (count !== undefined) {
      fields.push('poemcount')
      terms.push(String(count))
    }
  }
  const inputFields = fields.length > 0 ? fields : ['lines']
  const inputTerms = terms.length > 0 ? terms : [text]
  if (inputFields.length !== inputTerms.length) return `https://poetrydb.org/lines/${encodeURIComponent(text)}`

  const encodedTerms = inputTerms.map(term => encodeURIComponent(term)).join(';')
  const exact = options?.matchExact ? ':abs' : ''
  const output = stringList(options?.outputFields, ['author', 'title', 'lines', 'linecount', 'all'])
  if (output.length > 0 && !output.includes('all')) {
    const required = ['author', 'title', 'lines', 'linecount']
    const extras = output.filter(field => !required.includes(field))
    output.splice(0, output.length, ...required, ...extras)
  }
  const outputSegment = output.length > 0 ? `/${output.join(',')}` : ''
  return `https://poetrydb.org/${inputFields.join(',')}/${encodedTerms}${exact}${outputSegment}`
}

export function poetrydb() {
  return defineProvider({
    id: 'poetrydb',
    modalities: ['text'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      // /lines/<term> finds poems whose line content contains the term (closest to keyword search)
      const url = poetrydbUrl(q.text, q.providerOptions as PoetryDbSearchOptions | undefined, q.limit)
      const res = await ctx.fetch(url, { signal: ctx.signal })
      if (!res.ok) throw new Error(`poetrydb search failed: ${res.status}`)
      const json = (await res.json()) as PoetryDbPoem[] | { status: number }
      if (!Array.isArray(json)) return [] // no-match returns { status: 404, reason: 'Not found' }
      return json.map(toReference)
    },
  })
}
