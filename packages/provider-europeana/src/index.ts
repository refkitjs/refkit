import {
  defineProvider, referenceId,
  type Reference, type RightsRecord, type LicenseId,
  type NormalizedQuery, type ProviderContext,
} from '@refkit/core'

const BASE = 'https://api.europeana.eu/record/v2/search.json'

/** Map a Europeana `edm:rights` controlled-vocabulary URI to a core license id (+ CC version,
 *  + jurisdiction for jurisdiction-scoped PD). Conservative (D5): only clearly-open CC deeds and
 *  PD/CC0 become open grants; CC NC/ND → proprietary; rightsstatements.org is mapped faithfully
 *  per token (see below); anything unrecognized/empty → unknown. */
// rightsstatements.org is a rights-STATUS vocabulary (not license grants). Map each token
// FAITHFULLY (index D5-style): InC* → proprietary (copyrighted, no grant); NoC-US → PD scoped
// to the US via the jurisdiction field; NoC-NC → proprietary (non-commercial → commercial out);
// opaque/undetermined (NoC-OKLR/CR, CNE, UND, NKC) → unknown. (This mirrors core `mapRightsUrl`;
// the helper-refactor Task 4 replaces this inlined copy with that import.)
const RIGHTS_STATEMENT: Record<string, { license: LicenseId; jurisdiction?: string }> = {
  'inc': { license: 'proprietary' }, 'inc-ow-eu': { license: 'proprietary' }, 'inc-edu': { license: 'proprietary' },
  'inc-nc': { license: 'proprietary' }, 'inc-ruu': { license: 'proprietary' },
  'noc-us': { license: 'PD', jurisdiction: 'US' },
  'noc-nc': { license: 'proprietary' },
  'noc-oklr': { license: 'unknown' }, 'noc-cr': { license: 'unknown' },
  'cne': { license: 'unknown' }, 'und': { license: 'unknown' }, 'nkc': { license: 'unknown' },
}

export function mapEuropeanaRights(uri: string): { license: LicenseId; version?: string; jurisdiction?: string } {
  const u = (uri || '').toLowerCase()
  if (!u) return { license: 'unknown' }
  // rightsstatements.org — faithful per-token mapping (not blanket unknown).
  const rs = u.match(/rightsstatements\.org\/(?:vocab|page)\/([a-z-]+)/)
  if (rs) return RIGHTS_STATEMENT[rs[1]] ?? { license: 'unknown' }
  // Public domain dedications / marks (no version surfaced).
  if (u.includes('creativecommons.org/publicdomain/zero')) return { license: 'CC0-1.0' }
  if (u.includes('creativecommons.org/publicdomain/mark')) return { license: 'PD' }
  // Non-commercial / no-derivatives variants are NOT open grants → proprietary.
  // Checked before plain by/by-sa because "by-nc-sa" contains "by-sa".
  if (/creativecommons\.org\/licenses\/by-(?:nc|nd)/.test(u)) return { license: 'proprietary' }
  // Open CC deeds: capture the version (D7) for the attribution families only.
  const bySa = u.match(/creativecommons\.org\/licenses\/by-sa\/(\d\.\d)/)
  if (bySa) return { license: 'CC-BY-SA', version: bySa[1] }
  const by = u.match(/creativecommons\.org\/licenses\/by\/(\d\.\d)/)
  if (by) return { license: 'CC-BY', version: by[1] }
  return { license: 'unknown' }
}
