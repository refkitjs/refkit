import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface GutendexConfig {
  /** Gutendex/Cloudflare 403s without a real User-Agent; override if you want your own. */
  userAgent?: string
}

interface GutendexAuthor { name: string; birth_year: number | null; death_year: number | null }
interface GutendexResult {
  id: number
  title: string
  authors: GutendexAuthor[]
  summaries: string[]
  copyright: boolean | null
  media_type: string
  formats: Record<string, string>
}
interface GutendexResponse { results: GutendexResult[] }

// Project Gutenberg records carry a per-item copyright flag — NOT all are PD.
export function copyrightToLicense(copyright: boolean | null): LicenseId {
  if (copyright === false) return 'PD'
  if (copyright === true) return 'proprietary'
  return 'unknown'
}

function toReference(r: GutendexResult): Reference {
  const canonicalUrl = `https://www.gutenberg.org/ebooks/${r.id}`
  const rights: RightsRecord = {
    license: copyrightToLicense(r.copyright),
    author: r.authors[0]?.name,
    // PD/permission policy permits redistribution; note a book's cover image can be a separately-copyrighted work — host should treat covers conservatively (not legal advice).
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://www.gutenberg.org/policy/permission.html', sourceUrl: canonicalUrl },
  }
  const cover = r.formats['image/jpeg']
  const summary = r.summaries[0]
  return {
    id: referenceId('gutendex', canonicalUrl),
    modality: 'text',
    title: r.title,
    source: { providerId: 'gutendex', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: cover ? { url: cover } : undefined,
    // summaries[0] is an auto-generated synopsis (a structural description of the work),
    // not a verbatim passage — excerptKind 'structure'. Absent when summaries is empty.
    text: summary ? { excerpt: summary, excerptKind: 'structure', locator: canonicalUrl } : undefined,
    relevance: 0,
    raw: r,
  }
}

export function gutendex(config: GutendexConfig = {}) {
  return defineProvider({
    id: 'gutendex',
    modalities: ['text'],
    queryFeatures: ['keyword'],
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://gutendex.com/books/')
      url.searchParams.set('search', q.text)
      const res = await ctx.fetch(url.toString(), {
        headers: { 'User-Agent': config.userAgent ?? 'refkit (+https://github.com/MyPrototypeWhat/refkit)' },
        signal: ctx.signal,
      })
      if (!res.ok) throw new Error(`gutendex search failed: ${res.status}`)
      const json = (await res.json()) as GutendexResponse
      // text satellite — drop Sound/audio records
      return json.results.filter(r => r.media_type === 'Text').map(toReference)
    },
  })
}
