export type LicenseId =
  | 'CC0-1.0'
  | 'CC-BY'
  | 'CC-BY-SA'
  | 'PD'
  | 'unsplash'
  | 'pexels'
  | 'pixabay'
  | 'proprietary'
  | 'unknown'

/** Three-state: known-true / known-false / not-determinable. Drives strict-deny. */
export type Tri = true | false | 'unknown'

export interface LicenseFacts {
  commercialUse: Tri
  derivatives: Tri
  redistribution: Tri
  attributionRequired: boolean
  shareAlike: boolean
}

// Canonical, auditable license facts. The single source of truth for permissions —
// RightsRecord stores the license id; permissions are derived via factsFor(), never
// duplicated. Conservative by design: anything not clearly granted is false/unknown.
export const LICENSE_FACTS: Record<LicenseId, LicenseFacts> = {
  'CC0-1.0': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: false, shareAlike: false },
  'PD': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: false, shareAlike: false },
  'CC-BY': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: false },
  'CC-BY-SA': { commercialUse: true, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: true },
  // Stock-platform licenses: free to use incl. commercial, no attribution legally
  // required, but NOT redistributable as-is (can't resell/redistribute the asset itself).
  'unsplash': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'pexels': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'pixabay': { commercialUse: true, derivatives: true, redistribution: false, attributionRequired: false, shareAlike: false },
  'proprietary': { commercialUse: false, derivatives: false, redistribution: false, attributionRequired: false, shareAlike: false },
  'unknown': { commercialUse: 'unknown', derivatives: 'unknown', redistribution: 'unknown', attributionRequired: false, shareAlike: false },
}

/** Resolve facts for a license id; unrecognized → `unknown` (strict-deny fallback). */
export function factsFor(license: LicenseId): LicenseFacts {
  return LICENSE_FACTS[license] ?? LICENSE_FACTS.unknown
}
