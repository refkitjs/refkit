import {
  completeReference, parseEmitted, isLikelyImageUrl,
  type EmittedReference, type Reference, type ReferenceProvider, type NormalizedQuery, type ProviderContext,
  type LicenseId,
} from '@refkit/core'

export interface ConformanceOptions {
  /** Text query for the search. Default 'landscape'. */
  query?: string
  /** Extra NormalizedQuery fields (providerOptions, limit, controls…). */
  queryExtras?: Partial<NormalizedQuery>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Paths of the keys in an emitted item that parseEmitted dropped. The schema
 *  strips unknown keys (a field from another modality, a misspelt nested key)
 *  instead of rejecting the item, so this is where a provider learns it wrote
 *  one. Compares the top-level keys and the keys of nested objects and arrays;
 *  skips the top-level `raw` (free-form upstream payload) and keys whose value
 *  is undefined (nothing is lost). */
function lostKeys(input: unknown, parsed: unknown, path = ''): string[] {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    return input.flatMap((v, i) => lostKeys(v, parsed[i], `${path}[${i}]`))
  }
  if (!isRecord(input) || !isRecord(parsed)) return []
  return Object.keys(input).flatMap((k) => {
    if ((path === '' && k === 'raw') || input[k] === undefined) return []
    const at = path ? `${path}.${k}` : k
    // Own keys only: `in` would find `constructor` or `toString` on the
    // prototype and miss that the schema stripped them.
    return Object.hasOwn(parsed, k) ? lostKeys(input[k], parsed[k], at) : [at]
  })
}

/** Run provider.search through the given fetch and assert every conformance rule
 *  refkit demands of a satellite. Throws (with a per-item message) on violation;
 *  returns the parsed refs for further assertions. Works for fixture fetches AND
 *  the real global fetch (live smoke). Per item:
 *  - it parses as its modality's variant (incl. the preview mediaType prefix);
 *  - parsing lost no keys;
 *  - its modality is one the provider declares and one the query asked for, and
 *    its kind one the provider declares;
 *  - its thumbnail is not the landing page (every modality). */
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
  // Provenance (id, source, verifiedAt, relevance) is core's to stamp, so the
  // testkit completes each emitted item exactly as runProviderSearch would and
  // then asserts the rules that remain the SATELLITE's responsibility.
  const now = new Date().toISOString()
  return raw.map((item, i) => {
    let emitted: EmittedReference
    try {
      emitted = parseEmitted(item) // schema validity incl. sourceUrl, rights record, preview mediaType prefix
    } catch (e) {
      throw new Error(`[${provider.id}] result #${i} failed emittedReferenceSchema: ${(e as Error).message}`)
    }
    const lost = lostKeys(item, emitted)
    if (lost.length > 0) {
      throw new Error(`[${provider.id}] result #${i} lost keys in parseEmitted: ${lost.join(', ')} (not part of the ${emitted.modality} variant, e.g. a field from another modality)`)
    }
    // Modality consistency: a provider must never emit a modality it does not
    // declare, nor one the query did not ask for — core rejects the latter as a
    // modality leak (runProviderSearch checks query.modalities).
    if (!provider.modalities.includes(emitted.modality)) {
      throw new Error(`[${provider.id}] result #${i} modality "${emitted.modality}" is not in the provider's declared modalities [${provider.modalities.join(', ')}]`)
    }
    if (!query.modalities.includes(emitted.modality)) {
      throw new Error(`[${provider.id}] result #${i} modality "${emitted.modality}" is not in the query's modalities [${query.modalities.join(', ')}]`)
    }
    const ref: Reference = completeReference(provider.id, emitted, now)
    // Declared-kinds consistency: a provider stating what it offers must not
    // emit results outside that set. Missing kind is allowed (annotation is
    // optional); only a contradicting value is a violation.
    if (provider.kinds && provider.kinds.length > 0 && ref.kind !== undefined && !provider.kinds.includes(ref.kind)) {
      throw new Error(`[${provider.id}] result #${i} kind "${ref.kind}" is not in the provider's declared kinds [${provider.kinds.join(', ')}]`)
    }
    // D8 thumbnail rule, for every modality: a thumbnail is an image a UI can
    // show (a picture, a video poster, cover art, a book cover). Calibrated for
    // real providers: legitimate thumbnails are often extensionless CDN/proxy
    // URLs that no URL heuristic can bless (openverse `/v1/images/<id>/thumb/`,
    // smithsonian `deliveryService?...`, unsplash `photo-1?w=200`), so failing
    // isLikelyImageUrl MUST NOT fail the check — it is only an optional
    // fast-accept. We fail solely on the unambiguous D8 disaster case: the item's
    // landing page reused verbatim as the thumbnail. (The preview mediaType rule
    // is the schema's: each variant checks its own prefix in parseEmitted.)
    if (
      ref.thumbnail && !isLikelyImageUrl(ref.thumbnail.url)
      && (ref.thumbnail.url === ref.canonicalUrl || ref.thumbnail.url === ref.source.url)
    ) {
      throw new Error(`[${provider.id}] result #${i} thumbnail.url is the item's landing page, not an image resource: ${ref.thumbnail.url}`)
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
