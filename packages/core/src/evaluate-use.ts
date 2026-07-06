import { factsFor, type Tri } from './license'
import type { RightsRecord } from './rights'

export type Intent = 'internal-moodboard' | 'commercial-product' | 'ai-generation-input' | 'redistribution'
export type Decision = 'allowed' | 'allowed-with-attribution' | 'denied' | 'needs-review'

export interface Verdict {
  decision: Decision
  reasons: string[]
  confidence: 'high' | 'low'
  disclaimer: string
}

export const NOT_LEGAL_ADVICE =
  'Heuristic based on source-declared license/ToS facts; not legal advice.'

/** The tri-state permission axes of LicenseFacts. */
export type PermissionKey = 'commercialUse' | 'derivatives' | 'redistribution'

export interface EvaluateOptions {
  /** Treat editorial-only sources as denied (commercial-flavored uses). Default false. */
  denyEditorialOnly?: boolean
  /** Enforce attributionRequired as allowed-with-attribution. Default true; presets
   *  disable it for internal-moodboard (note-only). */
  enforceAttribution?: boolean
}

/** Low-level, programmable strict-deny gate: unknown license → needs-review;
 *  jurisdiction mismatch → needs-review; each required permission false → denied,
 *  'unknown' → needs-review; else allowed(-with-attribution). evaluateUse's four
 *  intents are presets over this. */
export function evaluatePermissions(
  r: RightsRecord,
  required: readonly PermissionKey[],
  ctx?: { userJurisdiction?: string },
  opts?: EvaluateOptions,
): Verdict {
  const denyEditorialOnly = opts?.denyEditorialOnly ?? false
  const enforceAttribution = opts?.enforceAttribution ?? true

  const facts = factsFor(r.license)
  const reasons: string[] = []
  const confidence: 'high' | 'low' = r.license === 'unknown' ? 'low' : 'high'
  const base = { reasons, confidence, disclaimer: NOT_LEGAL_ADVICE }

  // Unknown license: never allowed — needs-review regardless of required permissions.
  if (r.license === 'unknown') {
    reasons.push('license could not be determined (strict-deny)')
    return { decision: 'needs-review', ...base }
  }

  // editorial-only blocks commercial-flavored uses outright, when requested.
  if (r.editorialOnly && denyEditorialOnly) {
    reasons.push('source marked editorial-only')
    return { decision: 'denied', ...base }
  }

  // Jurisdiction (P0 minimal): if both the source jurisdiction and a user jurisdiction
  // are known and differ, defer to human review. Full logic is P2.
  if (ctx?.userJurisdiction && r.jurisdiction && ctx.userJurisdiction !== r.jurisdiction) {
    reasons.push(`source jurisdiction ${r.jurisdiction} != user jurisdiction ${ctx.userJurisdiction}`)
    return { decision: 'needs-review', ...base }
  }

  // Evaluate the required permissions with strict-deny semantics.
  for (const perm of required) {
    const value = facts[perm] as Tri
    if (value === false) {
      reasons.push(`${perm} not granted by ${r.license}`)
      return { decision: 'denied', ...base }
    }
    if (value === 'unknown') {
      reasons.push(`${perm} undetermined for ${r.license}`)
      return { decision: 'needs-review', ...base }
    }
  }

  reasons.push(`permitted for ${required.join('+') || 'use'} under ${r.license}`)
  // Lenient callers (e.g. internal-moodboard) surface a note instead of enforcing.
  if (facts.attributionRequired && !enforceAttribution) {
    reasons.push('attribution required by license but not enforced for internal-moodboard use')
  }
  const decision: Decision =
    facts.attributionRequired && enforceAttribution
      ? 'allowed-with-attribution'
      : 'allowed'
  return { decision, ...base }
}

// Which permission(s) an intent requires to be granted (true), plus the
// evaluatePermissions options that reproduce evaluateUse's historical behavior.
function presetFor(intent: Intent): { required: PermissionKey[]; opts: EvaluateOptions } {
  switch (intent) {
    case 'commercial-product':
      return { required: ['commercialUse'], opts: { denyEditorialOnly: true, enforceAttribution: true } }
    case 'ai-generation-input':
      return { required: ['commercialUse', 'derivatives'], opts: { denyEditorialOnly: true, enforceAttribution: true } }
    case 'redistribution':
      return { required: ['redistribution'], opts: { denyEditorialOnly: false, enforceAttribution: true } }
    case 'internal-moodboard':
      // lenient; gated only by the unknown/jurisdiction checks in evaluatePermissions
      return { required: [], opts: { denyEditorialOnly: false, enforceAttribution: false } }
  }
}

export function evaluateUse(
  r: RightsRecord,
  intent: Intent,
  ctx?: { userJurisdiction?: string },
): Verdict {
  const { required, opts } = presetFor(intent)
  return evaluatePermissions(r, required, ctx, opts)
}
