import {
  parseReference, isLikelyImageUrl, CC_FAMILY_BY_TOKEN,
  type Reference, type ReferenceProvider, type NormalizedQuery, type ProviderContext, type LicenseId,
} from '@refkit/core'

/** Licenses allowed to carry rights.licenseVersion (the six versioned CC families). */
const VERSIONED: ReadonlySet<LicenseId> = new Set(Object.values(CC_FAMILY_BY_TOKEN))

export interface ConformanceOptions {
  /** Text query for the search. Default 'landscape'. */
  query?: string
  /** Extra NormalizedQuery fields (providerOptions, limit, controls…). */
  queryExtras?: Partial<NormalizedQuery>
  /** Providers whose modality is image-only must yield image-like preview/thumbnail URLs (D8). Default true when provider.modalities includes 'image'. */
  enforceImageUrls?: boolean
}

/** Run provider.search through the given fetch and assert every conformance rule
 *  refkit demands of a satellite. Throws (with a per-item message) on violation;
 *  returns the parsed refs for further assertions. Works for fixture fetches AND
 *  the real global fetch (live smoke). */
export async function searchConformant(
  provider: ReferenceProvider,
  fetchImpl: typeof fetch,
  opts: ConformanceOptions = {},
): Promise<Reference[]> {
  const query: NormalizedQuery = {
    text: opts.query ?? 'landscape',
    modalities: provider.modalities,
    limit: 5,
    ...opts.queryExtras,
  }
  const ctx: ProviderContext = { fetch: fetchImpl }
  const raw = await provider.search(query, ctx)
  const enforceImages = opts.enforceImageUrls ?? provider.modalities.includes('image')
  return raw.map((item, i) => {
    let ref: Reference
    try {
      ref = parseReference(item) // schema validity incl. provenance trio + rights record
    } catch (e) {
      throw new Error(`[${provider.id}] result #${i} failed referenceSchema: ${(e as Error).message}`)
    }
    // Every satellite factory in this repo stamps referenceId(provider.id, …) as
    // `${provider.id}:${hash}` and sets `provider.id` to that exact same string —
    // verified across all current providers, including the dual-factory cases
    // where one package exports two distinct provider ids for two modalities/kinds
    // (openverse/openverse-audio, pexels/pexels-video, pixabay/pixabay-video,
    // polyhaven/ambientcg). None of those share a provider.id across prefixes, so
    // an exact `${provider.id}:` prefix match is sufficient and catches a provider
    // stamping the WRONG provider's id (e.g. openverse-audio results carrying an
    // 'openverse:' id) without needing a looser fallback.
    if (!ref.id.startsWith(`${provider.id}:`)) {
      throw new Error(`[${provider.id}] result #${i} id does not identify the provider (id=${ref.id}, provider.id=${provider.id})`)
    }
    if (ref.source.providerId !== provider.id) {
      throw new Error(`[${provider.id}] result #${i} source.providerId does not match the provider (source.providerId=${ref.source.providerId}, provider.id=${provider.id})`)
    }
    if (ref.rights.licenseVersion !== undefined && !VERSIONED.has(ref.rights.license)) {
      throw new Error(`[${provider.id}] result #${i} carries licenseVersion on non-CC-family license ${ref.rights.license}`)
    }
    if (enforceImages) {
      // D8: preview/thumbnail must be an image resource, never a web page
      if (ref.thumbnail && !isLikelyImageUrl(ref.thumbnail.url)) {
        throw new Error(`[${provider.id}] result #${i} thumbnail.url is not image-like: ${ref.thumbnail.url}`)
      }
      if (ref.preview && !ref.preview.mediaType.startsWith('image/')) {
        throw new Error(`[${provider.id}] result #${i} image preview has non-image mediaType: ${ref.preview.mediaType}`)
      }
    }
    return ref
  })
}

export interface LicenseMapCase<A> { input: A; expect: { license: LicenseId; version?: string } | LicenseId }

/** Data-driven license-mapping assertion: runs each case and reports every mismatch at once. */
export function expectLicenseMap<A>(
  mapFn: (input: A) => { license: LicenseId; version?: string } | LicenseId,
  cases: ReadonlyArray<LicenseMapCase<A>>,
): void {
  const failures = cases.flatMap(({ input, expect: want }) => {
    const got = mapFn(input)
    return JSON.stringify(got) === JSON.stringify(want) ? [] : [`map(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`]
  })
  if (failures.length > 0) throw new Error(`license mapping mismatches:\n${failures.join('\n')}`)
}
