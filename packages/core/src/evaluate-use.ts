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

// Which permission(s) an intent requires to be granted (true).
// strict-deny: a required permission that is false → denied; 'unknown' → needs-review.
function requiredPermissions(intent: Intent): Array<keyof ReturnType<typeof factsFor>> {
  switch (intent) {
    case 'commercial-product': return ['commercialUse']
    case 'ai-generation-input': return ['commercialUse', 'derivatives']
    case 'redistribution': return ['redistribution']
    case 'internal-moodboard': return [] // lenient; gated only by the unknown/proprietary checks below
  }
}

export function evaluateUse(
  r: RightsRecord,
  intent: Intent,
  ctx?: { userJurisdiction?: string },
): Verdict {
  const facts = factsFor(r.license)
  const reasons: string[] = []
  const confidence: 'high' | 'low' = r.license === 'unknown' ? 'low' : 'high'
  const base = { reasons, confidence, disclaimer: NOT_LEGAL_ADVICE }

  const commercialIntent = intent === 'commercial-product' || intent === 'ai-generation-input'

  // Unknown license: never allowed — needs-review regardless of intent.
  if (r.license === 'unknown') {
    reasons.push('license could not be determined (strict-deny)')
    return { decision: 'needs-review', ...base }
  }

  // editorial-only blocks commercial/AI use outright.
  if (r.editorialOnly && commercialIntent) {
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
  for (const perm of requiredPermissions(intent)) {
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

  reasons.push(`permitted for ${intent} under ${r.license}`)
  // internal-moodboard is lenient: attribution not enforced for internal-only use.
  if (facts.attributionRequired && intent === 'internal-moodboard') {
    reasons.push('attribution required by license but not enforced for internal-moodboard use')
  }
  const decision: Decision =
    facts.attributionRequired && intent !== 'internal-moodboard'
      ? 'allowed-with-attribution'
      : 'allowed'
  return { decision, ...base }
}
