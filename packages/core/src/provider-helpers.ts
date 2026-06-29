import type { LicenseId } from './license'

// — URL query-param setters (shared by every provider's search()) —

/** Set `key=value` when value is a non-empty string (optionally within an allowlist). */
export function setIfString(url: URL, key: string, value: unknown, allowed?: readonly string[]): void {
  if (typeof value !== 'string' || !value) return
  if (allowed && !allowed.includes(value)) return
  url.searchParams.set(key, value)
}

/** Set `key=true|false` when value is a boolean. */
export function setIfBoolean(url: URL, key: string, value: unknown): void {
  if (typeof value !== 'boolean') return
  url.searchParams.set(key, String(value))
}

/** Set `key` to a joined list from a string or string[] (default separator ",").
 *  Optional allowlist rejects the whole value if any element is not allowed. */
export function setIfStringList(
  url: URL, key: string, value: unknown,
  opts?: { separator?: string; allowed?: readonly string[] },
): void {
  const sep = opts?.separator ?? ','
  const allowed = opts?.allowed
  const ok = (v: string) => !allowed || allowed.includes(v)
  if (typeof value === 'string' && value && ok(value)) { url.searchParams.set(key, value); return }
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v && ok(v))) {
    url.searchParams.set(key, value.join(sep))
  }
}

/** Set `key` when value is an integer. `min` is a reject floor (value < min → skip).
 *  For `max`: the default REJECTS when value > max; with `clamp: true` it instead sets
 *  `max` — preserving the `Math.min(value, max)` clamp several providers rely on. */
export function setIfInt(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number; clamp?: boolean }): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) return
  if (opts?.min !== undefined && value < opts.min) return
  if (opts?.max !== undefined && value > opts.max) {
    if (opts.clamp) { url.searchParams.set(key, String(opts.max)); return }
    return
  }
  url.searchParams.set(key, String(value))
}

/** Integer ≥ (opts.min ?? 1). Pass `clamp: true` to clamp to `max` instead of rejecting. */
export function setIfPositiveInt(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number; clamp?: boolean }): void {
  setIfInt(url, key, value, { min: opts?.min ?? 1, max: opts?.max, clamp: opts?.clamp })
}

/** Integer ≥ (opts.min ?? 0). Pass `clamp: true` to clamp to `max` instead of rejecting. */
export function setIfNonNegativeInt(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number; clamp?: boolean }): void {
  setIfInt(url, key, value, { min: opts?.min ?? 0, max: opts?.max, clamp: opts?.clamp })
}

/** Set `key` when value is a finite number (non-integers allowed) within [min, max]. */
export function setIfNumber(url: URL, key: string, value: unknown, opts?: { min?: number; max?: number }): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  if (opts?.min !== undefined && value < opts.min) return
  if (opts?.max !== undefined && value > opts.max) return
  url.searchParams.set(key, String(value))
}

// — array helper —

/** First element of an array-typed field, or undefined. */
export function first<T>(arr: T[] | undefined | null): T | undefined {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined
}

// — license: CC deed URL → LicenseId (the moat; shared by URL-based sources) —

/** Map a Creative Commons deed URL to a core LicenseId (+ CC version for the BY/BY-SA
 *  families). Conservative: NC/ND variants → proprietary; PD mark / CC0 → PD / CC0-1.0;
 *  absent/unrecognized → unknown. **CC deeds only** — rightsstatements.org is handled by
 *  `mapRightsUrl`. Match is on the path so http/https both work. */
export function mapCcDeedUrl(url: string | undefined | null): { license: LicenseId; version?: string } {
  if (!url) return { license: 'unknown' }
  const u = url.toLowerCase()
  if (u.includes('creativecommons.org/publicdomain/zero')) return { license: 'CC0-1.0' }
  if (u.includes('creativecommons.org/publicdomain/mark')) return { license: 'PD' }
  // NC / ND are NOT open grants — check before plain by/by-sa ("by-nc-sa" contains "by-sa").
  if (/creativecommons\.org\/licenses\/by-(?:nc|nd)/.test(u)) return { license: 'proprietary' }
  const sa = u.match(/creativecommons\.org\/licenses\/by-sa\/(\d(?:\.\d)?)/)
  if (sa) return { license: 'CC-BY-SA', version: sa[1] }
  const by = u.match(/creativecommons\.org\/licenses\/by\/(\d(?:\.\d)?)/)
  if (by) return { license: 'CC-BY', version: by[1] }
  if (/creativecommons\.org\/licenses\/by-sa\b/.test(u)) return { license: 'CC-BY-SA' }
  if (/creativecommons\.org\/licenses\/by\b/.test(u)) return { license: 'CC-BY' }
  return { license: 'unknown' }
}

// rightsstatements.org is a controlled vocabulary of rights STATUS statements (not license
// grants). Map each token FAITHFULLY to the closest true refkit representation rather than
// collapsing all to unknown — discarding a signal the source did give us is not "honest":
//   • In-Copyright (InC*) → proprietary — we KNOW it's copyrighted with no grant (commercial
//     denied), which is more faithful than "needs-review".
//   • NoC-US → PD scoped to the US via the jurisdiction field (RightsRecord.jurisdiction
//     exists for exactly this; a jurisdiction-aware caller is gated, default stays lenient).
//   • NoC-NC → proprietary — no copyright BUT non-commercial only, so commercial is definitely
//     out (closest honest gate; loses the "non-commercial derivatives OK" nuance, which no
//     LicenseId can express — acceptable approximation).
//   • Opaque/undetermined (NoC-OKLR, NoC-CR, CNE, UND, NKC) → unknown (genuinely needs review).
const RIGHTS_STATEMENT: Record<string, { license: LicenseId; jurisdiction?: string }> = {
  'inc': { license: 'proprietary' }, 'inc-ow-eu': { license: 'proprietary' }, 'inc-edu': { license: 'proprietary' },
  'inc-nc': { license: 'proprietary' }, 'inc-ruu': { license: 'proprietary' },
  'noc-us': { license: 'PD', jurisdiction: 'US' },
  'noc-nc': { license: 'proprietary' },
  'noc-oklr': { license: 'unknown' }, 'noc-cr': { license: 'unknown' },
  'cne': { license: 'unknown' }, 'und': { license: 'unknown' }, 'nkc': { license: 'unknown' },
}

/** Map any rights URI — a CC deed OR a rightsstatements.org statement — to a faithful
 *  LicenseId (+ CC version / source jurisdiction). For sources whose rights field can be
 *  either (europeana `edm:rights`, internet-archive `licenseurl`). CC-only sources should
 *  call `mapCcDeedUrl` directly. Unknown rightsstatements tokens → unknown. */
export function mapRightsUrl(url: string | undefined | null): { license: LicenseId; version?: string; jurisdiction?: string } {
  if (!url) return { license: 'unknown' }
  const rs = url.toLowerCase().match(/rightsstatements\.org\/(?:vocab|page)\/([a-z-]+)/)
  if (rs) return RIGHTS_STATEMENT[rs[1]] ?? { license: 'unknown' }
  return mapCcDeedUrl(url)
}

// — image-URL heuristics (decision D8): preview.url must be an image, never a web page —

export const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?)(?:$|\?)/i

/** URL-string heuristic only (no network): does this look like an image resource? */
export function isLikelyImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url)
    || /iiif/i.test(url)
    || /\/full\/[^/]+\/\d+\/default/i.test(url) // IIIF Image API request path
    || /\/thumbnail\//i.test(url)
    || /googleusercontent\.com/.test(url)        // Rijksmuseum/Met image CDN
}

/** Best image mediaType: declared MIME if image/*, else inferred from extension, else default. */
export function imageMediaType(mime: string | undefined, url: string): string {
  if (mime && mime.startsWith('image/')) return mime
  const m = url.match(IMAGE_EXT)
  if (m) { const e = m[1].toLowerCase(); return e === 'jpg' ? 'image/jpeg' : `image/${e === 'tif' ? 'tiff' : e}` }
  return 'image/jpeg'
}
