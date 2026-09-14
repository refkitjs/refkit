export const LICENSE_IDS = [
  'CC0-1.0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND', 'PD',
  'unsplash', 'pexels', 'pixabay', 'proprietary', 'unknown',
] as const

export type KnownLicenseId = (typeof LICENSE_IDS)[number]
/** Open id: known ids resolve to LICENSE_FACTS; any other id must ship its own
 *  `facts` on the RightsRecord, else it is treated as `unknown` (strict-deny). */
export type LicenseId = KnownLicenseId | (string & {})

export function isKnownLicenseId(id: string): id is KnownLicenseId {
  return (LICENSE_IDS as readonly string[]).includes(id)
}

/** Three-state: known-true / known-false / not-determinable. Drives strict-deny. */
export type Tri = true | false | 'unknown'

export interface LicenseFacts {
  commercialUse: Tri
  derivatives: Tri
  redistribution: Tri
  attributionRequired: boolean
  shareAlike: boolean
}

// Canonical, auditable license facts for the known ids. Conservative by design:
// anything not clearly granted is false/unknown.
export const LICENSE_FACTS: Record<KnownLicenseId, LicenseFacts> = {
  'CC0-1.0': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: false, shareAlike: false },
  'PD': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: false, shareAlike: false },
  'CC-BY': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: false },
  'CC-BY-SA': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: true },
  // NC family: sharing/derivatives are granted only NON-commercially. The
  // 'redistribution' intent doesn't model commercial vs non-commercial, so the
  // honest tri-state is 'unknown' (→ needs-review).
  'CC-BY-NC': { commercialUse: false, derivatives: true, redistribution: 'unknown', attributionRequired: true, shareAlike: false },
  'CC-BY-NC-SA': { commercialUse: false, derivatives: true, redistribution: 'unknown', attributionRequired: true, shareAlike: true },
  'CC-BY-NC-ND': { commercialUse: false, derivatives: false, redistribution: 'unknown', attributionRequired: true, shareAlike: false },
  // ND: verbatim reuse (incl. commercial) is granted; derivatives are not.
  'CC-BY-ND': { commercialUse: true, derivatives: false, redistribution: true, attributionRequired: true, shareAlike: false },
  // Stock-platform licenses: free incl. commercial, no attribution legally required,
  // but NOT redistributable as-is.
  'unsplash': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'pexels': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'pixabay': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'proprietary': { commercialUse: false, derivatives: false, redistribution: false, attributionRequired: false, shareAlike: false },
  'unknown': { commercialUse: 'unknown', derivatives: 'unknown', redistribution: 'unknown', attributionRequired: false, shareAlike: false },
}

/** Resolve facts for an id; unrecognized → `unknown` (strict-deny fallback). */
export function factsFor(license: LicenseId): LicenseFacts {
  return (LICENSE_FACTS as Record<string, LicenseFacts>)[license] ?? LICENSE_FACTS.unknown
}

/** All three permission axes undeterminable — nothing can be granted or denied. */
export function isIndeterminate(f: LicenseFacts): boolean {
  return f.commercialUse === 'unknown' && f.derivatives === 'unknown' && f.redistribution === 'unknown'
}

// — restrictiveness partial order (used by cross-source conflict resolution) —
// Each axis ranks smaller = stricter. One facts row is "no more permissive" than
// another when it is ≤ on EVERY axis; pairs that each grant something the other
// doesn't are incomparable.
const triRank = (t: Tri): number => (t === true ? 2 : t === 'unknown' ? 1 : 0)

function permissivenessVector(f: LicenseFacts): number[] {
  return [
    triRank(f.commercialUse),
    triRank(f.derivatives),
    triRank(f.redistribution),
    f.attributionRequired ? 0 : 1, // carrying the obligation is stricter
    f.shareAlike ? 0 : 1,
  ]
}

export function compareRestrictiveness(a: LicenseFacts, b: LicenseFacts): 'a' | 'b' | 'equal' | 'incomparable' {
  const va = permissivenessVector(a)
  const vb = permissivenessVector(b)
  let aNoMorePermissive = true
  let bNoMorePermissive = true
  for (let i = 0; i < va.length; i++) {
    if (va[i] > vb[i]) aNoMorePermissive = false
    if (vb[i] > va[i]) bNoMorePermissive = false
  }
  if (aNoMorePermissive && bNoMorePermissive) return 'equal'
  if (aNoMorePermissive) return 'a'
  if (bNoMorePermissive) return 'b'
  return 'incomparable'
}

/** Scalar permissiveness in 0..1 for ranking boosts. Grants weigh 2, obligations 1;
 *  an 'unknown' axis counts as NOT granted, mirroring the strict-deny gate. */
export function permissivenessScore(f: LicenseFacts): number {
  const granted = (t: Tri): number => (t === true ? 1 : 0)
  return (
    2 * granted(f.commercialUse) + 2 * granted(f.derivatives) + 2 * granted(f.redistribution)
    + (f.attributionRequired ? 0 : 1) + (f.shareAlike ? 0 : 1)
  ) / 8
}

// — CC version metadata (attribution/audit only; never read by the gate) —

/** The six versioned CC families — the only ids allowed to carry licenseVersion. */
export const CC_VERSIONED_FAMILIES: ReadonlySet<string> = new Set([
  'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC-BY-ND',
])

/** `version` when `license` is a versioned CC family, else undefined. */
export function ccVersionFor(license: LicenseId, version: string | undefined): string | undefined {
  return version !== undefined && CC_VERSIONED_FAMILIES.has(license) ? version : undefined
}
