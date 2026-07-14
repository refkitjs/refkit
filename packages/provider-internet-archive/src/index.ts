import {
  defineProvider, referenceId, mapRightsUrl, ccVersionFor,
  type Reference, type RightsRecord, type Modality,
  type NormalizedQuery, type ProviderContext,
  setIfPositiveInt,
} from '@refkit/core'

const BASE = 'https://archive.org/advancedsearch.php'

export interface InternetArchiveConfig {
  /** Max docs requested per search (advancedsearch `rows`). Default falls back to
   *  the query limit, then 20. Bounded to 100. */
  maxRows?: number
}

/** Map an Internet Archive `licenseurl` to our license id (+ CC version, + jurisdiction for
 *  jurisdiction-scoped PD). The field can be a CC deed OR a rightsstatements.org statement, so
 *  this is exactly core `mapRightsUrl`, re-exported under the IA-specific name the tests import.
 *  **ABSENT licenseurl → 'unknown' (D3)** — IA rarely carries one, so most items legitimately
 *  land in needs-review; this "never guess PD" rule governs the ABSENT case only (core
 *  `mapRightsUrl(undefined) → unknown`). A PRESENT rightsstatements.org statement is a real
 *  declaration mapped faithfully (NoC-US → PD is the source's word, not a guess). */
export const mapIaLicense = mapRightsUrl

/** Escape Lucene reserved syntax in the user query so it stays a literal term
 *  inside the composed expression — unescaped `)` would break the grouping and
 *  `) OR (mediatype:...` could escape the movies/texts scope entirely. */
export function escapeLucene(text: string): string {
  return text.replace(/&&|\|\||[+\-!(){}[\]^"~*?:\\/]/g, (m) => [...m].map(c => `\\${c}`).join(''))
}

const MEDIATYPE_MODALITY: Record<string, Modality> = { movies: 'video', texts: 'text' }

/** v1 scope (D1): only `movies`→video and `texts`→text. Everything else → null
 *  (filtered out). audio / image / etc. are a documented follow-up. */
export function mediatypeToModality(mt: string): Modality | null {
  return MEDIATYPE_MODALITY[mt] ?? null
}

interface IaDoc {
  identifier: string
  title?: string | string[]
  creator?: string | string[]
  licenseurl?: string | string[]
  mediatype: string
}
interface IaResponse { response?: { numFound: number; docs: IaDoc[] } }

function authorOf(creator: string | string[] | undefined): string | undefined {
  if (!creator) return undefined
  return Array.isArray(creator) ? creator.join(', ') || undefined : creator || undefined
}

/** Map one search doc → Reference, or null if its mediatype is out of v1 scope (D1).
 *  canonicalUrl = the details page; thumbnail = the services image endpoint; preview
 *  omitted (search exposes no clean direct media stream). */
export function toReference(doc: IaDoc): Reference | null {
  const modality = mediatypeToModality(doc.mediatype)
  if (!modality) return null
  const canonicalUrl = `https://archive.org/details/${doc.identifier}`
  // Solr fields can arrive as scalars OR arrays — coerce to the first scalar before mapping.
  const licenseurl = Array.isArray(doc.licenseurl) ? doc.licenseurl[0] : doc.licenseurl
  const title = Array.isArray(doc.title) ? doc.title[0] : doc.title
  const { license, version, jurisdiction } = mapIaLicense(licenseurl)
  const rights: RightsRecord = {
    license,
    // CC version is metadata only (attribution/audit), kept for every versioned CC family —
    // NC stays denied for commercial/AI use; ND allows verbatim commercial reuse
    // (allowed-with-attribution) but stays denied for AI/derivative use.
    licenseVersion: ccVersionFor(license, version),
    // jurisdiction-scoped PD (e.g. rightsstatements NoC-US → PD in the US)
    ...(jurisdiction ? { jurisdiction } : {}),
    author: authorOf(doc.creator),
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://archive.org/about/terms.php', sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('internet-archive', canonicalUrl),
    modality,
    title: title || undefined,
    source: { providerId: 'internet-archive', sourceUrl: canonicalUrl },
    canonicalUrl,
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: `https://archive.org/services/img/${doc.identifier}` },
    relevance: 0,
    raw: doc,
  }
}

export function internetArchive(config: InternetArchiveConfig = {}) {
  return defineProvider({
    id: 'internet-archive',
    modalities: ['video', 'text'],
    capabilities: { controls: ['page'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL(BASE)
      url.searchParams.set('q', `(${escapeLucene(q.text)}) AND mediatype:(movies OR texts)`)
      for (const f of ['identifier', 'title', 'creator', 'licenseurl', 'mediatype']) {
        url.searchParams.append('fl[]', f)
      }
      url.searchParams.set('output', 'json')
      url.searchParams.set('page', '1')
      setIfPositiveInt(url, 'page', q.controls?.page)
      const rows = Math.min(config.maxRows ?? q.limit ?? 20, 100)
      url.searchParams.set('rows', String(rows))
      const res = await ctx.fetch(url.toString(), { signal: ctx.signal })
      if (!res.ok) throw new Error(`internet-archive search failed: ${res.status}`)
      const json = (await res.json()) as IaResponse
      const docs = json.response?.docs ?? []
      return docs
        .map(toReference)
        .filter((r): r is Reference => r !== null)
    },
  })
}
