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
  /** Providers whose modality is image-only must yield image-like preview/thumbnail URLs (D8). Default true when provider.modalities includes 'image'.
   *  Caveat: mixed-modality factories (image plus others) also default to true — pass false explicitly if their non-image results legitimately carry non-image previews. */
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
      // D8 thumbnail rule, calibrated for real providers: legitimate thumbnails are
      // often extensionless CDN/proxy URLs that no URL heuristic can bless
      // (openverse `/v1/images/<id>/thumb/`, smithsonian `deliveryService?...`,
      // unsplash `photo-1?w=200`), so failing isLikelyImageUrl MUST NOT fail the
      // check — it is only an optional fast-accept. We fail solely on the
      // unambiguous D8 disaster case: the item's landing page reused verbatim as
      // the thumbnail.
      if (
        ref.thumbnail && !isLikelyImageUrl(ref.thumbnail.url)
        && (ref.thumbnail.url === ref.canonicalUrl || ref.thumbnail.url === ref.source.sourceUrl)
      ) {
        throw new Error(`[${provider.id}] result #${i} thumbnail.url is the item's landing page, not an image resource: ${ref.thumbnail.url}`)
      }
      // D8 preview rule: preview is the rehostable asset — for image providers its
      // declared mediaType must be image/*.
      if (ref.preview && !ref.preview.mediaType.startsWith('image/')) {
        throw new Error(`[${provider.id}] result #${i} image preview has non-image mediaType: ${ref.preview.mediaType}`)
      }
    }
    return ref
  })
}

/** What a license-mapping function may return (mapCcDeedUrl/mapRightsUrl shape). */
export interface LicenseMapResult { license: LicenseId; version?: string; jurisdiction?: string }

export interface LicenseMapCase<A> { input: A; expect: LicenseId | LicenseMapResult }

function asResult(v: LicenseId | LicenseMapResult): LicenseMapResult {
  return typeof v === 'string' ? { license: v } : v
}

/** Data-driven license-mapping assertion: runs each case and reports every mismatch
 *  at once. Comparison is field-wise (key-order-insensitive): license and version
 *  must match exactly; jurisdiction is compared ONLY when the expectation specifies
 *  it, so mapRightsUrl-style extra keys on the result don't false-fail a plain
 *  `{license}` expectation. */
export function expectLicenseMap<A>(
  mapFn: (input: A) => LicenseId | LicenseMapResult,
  cases: ReadonlyArray<LicenseMapCase<A>>,
): void {
  const failures = cases.flatMap(({ input, expect: want }) => {
    const g = asResult(mapFn(input))
    const w = asResult(want)
    const ok = g.license === w.license
      && g.version === w.version
      && (w.jurisdiction === undefined || g.jurisdiction === w.jurisdiction)
    return ok ? [] : [`map(${JSON.stringify(input)}) = ${JSON.stringify(g)}, want ${JSON.stringify(w)}`]
  })
  if (failures.length > 0) throw new Error(`license mapping mismatches:\n${failures.join('\n')}`)
}
