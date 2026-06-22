import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

interface PoetryDbPoem { title: string; author: string; lines: string[]; linecount: string }

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

export function poetrydb() {
  return defineProvider({
    id: 'poetrydb',
    modalities: ['text'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      // /lines/<term> finds poems whose line content contains the term (closest to keyword search)
      const url = `https://poetrydb.org/lines/${encodeURIComponent(q.text)}`
      const res = await ctx.fetch(url, { signal: ctx.signal })
      if (!res.ok) throw new Error(`poetrydb search failed: ${res.status}`)
      const json = (await res.json()) as PoetryDbPoem[] | { status: number }
      if (!Array.isArray(json)) return [] // no-match returns { status: 404, reason: 'Not found' }
      return json.map(toReference)
    },
  })
}
