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

/** Partial order over facts rows: `'a'`/`'b'` names the no-more-permissive side,
 *  `'equal'` identical grants and obligations, `'incomparable'` a pair where each
 *  grants something the other doesn't. An INDETERMINATE operand is always
 *  `'incomparable'`: an all-unknown row grants nothing determinable, so it can be
 *  neither dominated nor dominating — ordering it would invent a fact. */
export function compareRestrictiveness(a: LicenseFacts, b: LicenseFacts): 'a' | 'b' | 'equal' | 'incomparable' {
  if (isIndeterminate(a) || isIndeterminate(b)) return 'incomparable'
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

/** Scalar permissiveness in 0..1 for ranking boosts:
 *  `(2c + 2d + 2r + g·(attr + sa)) / 8`, where each tri axis counts 1 only for
 *  `true` (an 'unknown' axis is NOT granted, mirroring the strict-deny gate),
 *  `attr` is 1 when attribution is not required, `sa` is 1 when share-alike is off,
 *  and `g = (c + d + r) / 3` is the grant fraction. Scaling the obligation credit
 *  by `g` is what keeps a row that grants nothing (proprietary, unknown) at 0, so
 *  "no permissions, but no obligations either" can never outrank a real grant.
 *  Order: CC0/PD 1 > CC-BY 0.875 > CC-BY-SA 0.75 > stock 0.667 > CC-BY-ND 0.583 >
 *  CC-BY-NC 0.292 > CC-BY-NC-SA 0.25 > CC-BY-NC-ND = proprietary = unknown = 0. */
export function permissivenessScore(f: LicenseFacts): number {
  const granted = (t: Tri): number => (t === true ? 1 : 0)
  const c = granted(f.commercialUse)
  const d = granted(f.derivatives)
  const r = granted(f.redistribution)
  const grantFraction = (c + d + r) / 3
  const obligations = (f.attributionRequired ? 0 : 1) + (f.shareAlike ? 0 : 1)
  return (2 * c + 2 * d + 2 * r + grantFraction * obligations) / 8
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
