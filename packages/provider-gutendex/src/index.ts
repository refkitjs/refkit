import {
  defineProvider, referenceId,
  setIfInt, setIfPositiveInt, setIfString, setIfStringList,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

export interface GutendexConfig {
  /** Gutendex/Cloudflare 403s without a real User-Agent; override if you want your own. */
  userAgent?: string
}

export interface GutendexSearchOptions {
  authorYearStart?: number
  authorYearEnd?: number
  copyright?: 'true' | 'false' | 'null' | readonly ('true' | 'false' | 'null')[]
  ids?: string | readonly string[]
  languages?: string | readonly string[]
  mimeType?: string
  sort?: 'ascending' | 'descending' | 'popular'
  topic?: string
  page?: number
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
    capabilities: { controls: ['language', 'text.copyright', 'page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://gutendex.com/books/')
      url.searchParams.set('search', q.text)
      if (q.controls?.language) url.searchParams.set('languages', q.controls.language)
      if (q.controls?.text?.copyright === 'public-domain') url.searchParams.set('copyright', 'false')
      if (q.controls?.text?.copyright === 'copyrighted') url.searchParams.set('copyright', 'true')
      setIfPositiveInt(url, 'page', q.controls?.page)
      const opts = q.providerOptions as GutendexSearchOptions | undefined
      setIfInt(url, 'author_year_start', opts?.authorYearStart)
      setIfInt(url, 'author_year_end', opts?.authorYearEnd)
      setIfStringList(url, 'copyright', opts?.copyright, { allowed: ['true', 'false', 'null'] })
      setIfStringList(url, 'ids', opts?.ids)
      setIfStringList(url, 'languages', opts?.languages)
      setIfString(url, 'mime_type', opts?.mimeType)
      setIfString(url, 'sort', opts?.sort, ['ascending', 'descending', 'popular'])
      setIfString(url, 'topic', opts?.topic)
      setIfPositiveInt(url, 'page', opts?.page)
      const res = await ctx.fetch(url.toString(), {
        // Cloudflare in front of gutendex.com intermittently 403s datacenter IPs
        // (e.g. GitHub Actions) at the fingerprint level — verified that neither a
        // descriptive bot UA nor a browser UA gets through (live-smoke runs 1-3),
        // so we keep the honest UA. Residential/user traffic is unaffected; the
        // live-smoke suite treats these 403s as inconclusive rather than as drift.
        headers: {
          'User-Agent': config.userAgent ?? 'refkit (+https://github.com/refkitjs/refkit)',
          Accept: 'application/json',
        },
        signal: ctx.signal,
      })
      if (!res.ok) throw new Error(`gutendex search failed: ${res.status}`)
      const json = (await res.json()) as GutendexResponse
      // text satellite — drop Sound/audio records
      return json.results.filter(r => r.media_type === 'Text').map(toReference)
    },
  })
}
