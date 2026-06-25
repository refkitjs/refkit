import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type NormalizedQuery, type ProviderContext, type SearchSafety,
} from '@refkit/core'

export interface BraveConfig {
  token: string
  /** Brave safesearch: 'strict' (default) or 'off'. */
  safesearch?: 'strict' | 'off'
}

export interface BraveImageSearchOptions {
  country?: string
  searchLang?: string
  count?: number
  safesearch?: 'strict' | 'off'
  spellcheck?: boolean
}

interface BraveImageResult {
  title: string
  url: string                  // the source webpage (canonical link)
  source: string               // domain
  thumbnail: { src: string }   // Brave-proxied thumbnail (safe to display)
  properties: { url: string; placeholder?: string }  // origin/CDN full image (do NOT rehost)
}
interface BraveResponse { results: BraveImageResult[] }

function braveSafeSearch(control: SearchSafety | undefined, fallback: BraveConfig['safesearch']): 'strict' | 'off' {
  if (control === 'off') return 'off'
  if (control === 'strict' || control === 'moderate') return 'strict'
  return fallback ?? 'strict'
}

function setIfString(url: URL, key: string, value: unknown, allowed?: readonly string[]) {
  if (typeof value !== 'string' || !value) return
  if (allowed && !allowed.includes(value)) return
  url.searchParams.set(key, value)
}

function setIfPositiveInt(url: URL, key: string, value: unknown, max?: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return
  url.searchParams.set(key, String(max ? Math.min(value, max) : value))
}

function setIfBoolean(url: URL, key: string, value: unknown) {
  if (typeof value !== 'boolean') return
  url.searchParams.set(key, String(value))
}

function toReference(r: BraveImageResult): Reference {
  const rights: RightsRecord = {
    // open web → no license metadata → evaluateUse returns needs-review (never auto-allowed)
    license: 'unknown',
    // only the Brave-proxied thumbnail is safe to show; never rehost properties.url (origin image)
    rehostPolicy: 'thumbnail-only',
    raw: { sourceTerms: '', sourceUrl: r.url },
  }
  return {
    id: referenceId('brave', r.properties.url), // origin image URL is the most stable identifier
    modality: 'image',
    title: r.title,
    source: { providerId: 'brave', sourceUrl: r.url },
    canonicalUrl: r.url, // the source webpage, not the raw image bytes
    rights,
    verifiedAt: new Date().toISOString(),
    thumbnail: { url: r.thumbnail.src },
    relevance: 0,
    raw: r,
  }
}

export function brave(config: BraveConfig) {
  return defineProvider({
    id: 'brave',
    modalities: ['image'],
    queryFeatures: ['keyword'],
    capabilities: { controls: ['safety'] },
    async search(q: NormalizedQuery, ctx: ProviderContext): Promise<Reference[]> {
      const url = new URL('https://api.search.brave.com/res/v1/images/search')
      url.searchParams.set('q', q.text)
      url.searchParams.set('count', String(Math.min(q.limit ?? 50, 200)))
      url.searchParams.set('safesearch', braveSafeSearch(q.controls?.safety, config.safesearch))
      const opts = q.providerOptions as BraveImageSearchOptions | undefined
      setIfString(url, 'country', opts?.country)
      setIfString(url, 'search_lang', opts?.searchLang)
      setIfPositiveInt(url, 'count', opts?.count, 200)
      setIfString(url, 'safesearch', opts?.safesearch, ['strict', 'off'])
      setIfBoolean(url, 'spellcheck', opts?.spellcheck)
      const res = await ctx.fetch(url.toString(), {
        headers: { 'X-Subscription-Token': config.token, Accept: 'application/json' },
        signal: ctx.signal,
      })
      if (!res.ok) throw new Error(`brave search failed: ${res.status}`)
      const json = (await res.json()) as BraveResponse
      return json.results.map(toReference)
    },
  })
}
