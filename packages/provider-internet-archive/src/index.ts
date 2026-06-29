import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId, type Modality,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

const BASE = 'https://archive.org/advancedsearch.php'

export interface InternetArchiveConfig {
  /** Max docs requested per search (advancedsearch `rows`). Default falls back to
   *  the query limit, then 20. Bounded to 100. */
  maxRows?: number
}

// rightsstatements.org is a rights-STATUS vocabulary (not license grants). Mapped faithfully
// per token (mirrors core `mapRightsUrl`; helper-refactor Task 4 dedups this): InC* →
// proprietary; NoC-US → PD scoped to the US; NoC-NC → proprietary; opaque/undetermined → unknown.
const RIGHTS_STATEMENT: Record<string, { license: LicenseId; jurisdiction?: string }> = {
  'inc': { license: 'proprietary' }, 'inc-ow-eu': { license: 'proprietary' }, 'inc-edu': { license: 'proprietary' },
  'inc-nc': { license: 'proprietary' }, 'inc-ruu': { license: 'proprietary' },
  'noc-us': { license: 'PD', jurisdiction: 'US' },
  'noc-nc': { license: 'proprietary' },
  'noc-oklr': { license: 'unknown' }, 'noc-cr': { license: 'unknown' },
  'cne': { license: 'unknown' }, 'und': { license: 'unknown' }, 'nkc': { license: 'unknown' },
}

/** Map an Internet Archive `licenseurl` to our license id (+ CC version, + jurisdiction for
 *  jurisdiction-scoped PD). **ABSENT licenseurl → 'unknown' (D3)** — IA rarely carries one, so
 *  most items legitimately land here → needs-review; this is the "never guess PD" rule and it
 *  governs the ABSENT case only. A PRESENT rightsstatements.org statement is a real declaration
 *  and is mapped faithfully (NoC-US → PD is the source's word, not a guess). NC/ND → proprietary
 *  (D5); PD mark/dedication → PD; CC0 → CC0-1.0; unrecognized → unknown. */
export function mapIaLicense(licenseurl?: string): { license: LicenseId; version?: string; jurisdiction?: string } {
  if (!licenseurl) return { license: 'unknown' }
  const u = licenseurl.toLowerCase()
  const rs = u.match(/rightsstatements\.org\/(?:vocab|page)\/([a-z-]+)/)
  if (rs) return RIGHTS_STATEMENT[rs[1]] ?? { license: 'unknown' }
  if (/\/publicdomain\/zero\b/.test(u)) return { license: 'CC0-1.0' }
  if (/\/publicdomain\/mark\b/.test(u)) return { license: 'PD' }
  // Exclude any NC / ND variant before matching the open by / by-sa families.
  if (/\/licenses\/by-(?:nc|nd)/.test(u)) return { license: 'proprietary' }
  const bySa = u.match(/\/licenses\/by-sa\/(\d(?:\.\d)?)\b/)
  if (bySa) return { license: 'CC-BY-SA', version: bySa[1] }
  const by = u.match(/\/licenses\/by\/(\d(?:\.\d)?)\b/)
  if (by) return { license: 'CC-BY', version: by[1] }
  // by / by-sa with no version still maps to the family (version omitted).
  if (/\/licenses\/by-sa\b/.test(u)) return { license: 'CC-BY-SA' }
  if (/\/licenses\/by\b/.test(u)) return { license: 'CC-BY' }
  return { license: 'unknown' }
}

const MEDIATYPE_MODALITY: Record<string, Modality> = { movies: 'video', texts: 'text' }

/** v1 scope (D1): only `movies`→video and `texts`→text. Everything else → null
 *  (filtered out). audio / image / etc. are a documented follow-up. */
export function mediatypeToModality(mt: string): Modality | null {
  return MEDIATYPE_MODALITY[mt] ?? null
}

interface IaDoc {
  identifier: string
  title?: string
  creator?: string | string[]
  licenseurl?: string
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
  const { license, version, jurisdiction } = mapIaLicense(doc.licenseurl)
  const rights: RightsRecord = {
    license,
    licenseVersion: license === 'CC-BY' || license === 'CC-BY-SA' ? version : undefined,
    // jurisdiction-scoped PD (e.g. rightsstatements NoC-US → PD in the US)
    ...(jurisdiction ? { jurisdiction } : {}),
    author: authorOf(doc.creator),
    rehostPolicy: 'cache-allowed',
    raw: { sourceTerms: 'https://archive.org/about/terms.php', sourceUrl: canonicalUrl },
  }
  return {
    id: referenceId('internet-archive', canonicalUrl),
    modality,
    title: doc.title || undefined,
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
    queryFeatures: ['keyword'],
    capabilities: { controls: [] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL(BASE)
      url.searchParams.set('q', q.text)
      for (const f of ['identifier', 'title', 'creator', 'licenseurl', 'mediatype']) {
        url.searchParams.append('fl[]', f)
      }
      url.searchParams.set('output', 'json')
      url.searchParams.set('page', '1')
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
