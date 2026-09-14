import type { Reference } from './reference'
import { factsOf, type RightsRecord } from './rights'
import { compareRestrictiveness, type LicenseFacts, type LicenseId } from './license'
import { canonicalizeUrl } from './dedup-key'
import { dedupeReferences, type DedupeOptions } from './dedup'

/** A cross-source disagreement about the license of the same canonical URL,
 *  reported once per URL after the merge pass. */
export interface RightsConflict {
  canonicalUrl: string
  /** Every distinct SOURCE-DECLARED license id for this URL (never includes a
   *  synthetic resolution value a source didn't claim). A single id when the
   *  sources agreed on the label and only their facts disagreed. */
  licenses: LicenseId[]
  /** What the merge resolved to: the strictest comparable claim, or 'unknown'
   *  when claims are incomparable (strict-deny → needs-review). */
  resolvedLicense: LicenseId
}

export interface MergeOptions extends DedupeOptions {
  /** RRF dampening constant. Standard default 60. */
  k?: number
  /** Observe cross-source license conflicts (the client surfaces them as
   *  meta.warnings). Resolution itself is built in and always conservative. */
  onRightsConflict?: (conflict: RightsConflict) => void
}

// — conservative rights resolution for cross-source URL conflicts —
// Two sources describing the SAME canonical URL are making claims about the same
// work; when their claims disagree, believing the more permissive one would be
// fail-open. Disagreement is measured over FACTS, never over the license label:
// the same id carrying narrower supplied facts IS a conflict, and two different
// ids with identical facts (CC0-1.0 vs PD) are NOT. Claims are compared under
// compareRestrictiveness's partial order; incomparable pairs — which include
// every pair with an indeterminate side — collapse to 'unknown' (→ needs-review),
// matching the strict-deny invariant.

/** Fingerprint of a facts row: two records with the same key make the same claim. */
function factsKey(f: LicenseFacts): string {
  return `${f.commercialUse}|${f.derivatives}|${f.redistribution}|${f.attributionRequired}|${f.shareAlike}`
}

function unknownRecord(anchor: RightsRecord): RightsRecord {
  // No honest single license exists for the conflict: strict-deny to 'unknown'.
  // Keep the anchor's per-item data as the audit trail; drop facts/version that
  // only made sense for the original id.
  return { ...anchor, license: 'unknown', licenseVersion: undefined, facts: undefined }
}

function resolveRightsConflict(current: RightsRecord, incoming: RightsRecord): RightsRecord {
  // 'incomparable' also covers an indeterminate side (see compareRestrictiveness):
  // nothing determinable is granted, so the conflict can only resolve to unknown.
  const cmp = compareRestrictiveness(factsOf(current), factsOf(incoming))
  if (cmp === 'a' || cmp === 'equal') return current
  if (cmp === 'b') return incoming
  return unknownRecord(current)
}

// Reciprocal Rank Fusion across per-source ranked lists. Each list is assumed already
// ordered best-first by its source. The same item (by canonical URL) appearing across
// lists accumulates score, so cross-source agreement floats to the top — without
// needing comparable absolute scores. Output relevance is max-normalized to 0..1.
export function mergeReferences(perSource: Reference[][], opts: MergeOptions = {}): Reference[] {
  const k = opts.k ?? 60
  const score = new Map<string, number>() // dedup key -> accumulated RRF score
  const rep = new Map<string, Reference>() // dedup key -> best representative
  const rights = new Map<string, RightsRecord>() // dedup key -> conservatively-resolved rights
  // Both allocated only on an actual conflict, per dedup key. conflictFacts holds
  // the distinct claims seen, as facts fingerprints; comparing a new ref against
  // it (not against the resolved record, which may already be a synthetic
  // 'unknown') keeps a third source repeating an already-seen claim from
  // re-triggering a phantom conflict. conflictLabels holds the ids those claims
  // were declared under — for the report only, never for detection.
  const conflictFacts = new Map<string, Set<string>>()
  const conflictLabels = new Map<string, Set<LicenseId>>()

  for (const list of perSource) {
    list.forEach((ref, rank) => {
      const key = canonicalizeUrl(ref.canonicalUrl)
      score.set(key, (score.get(key) ?? 0) + 1 / (k + rank))
      const cur = rep.get(key)
      if (!cur || ref.relevance > cur.relevance) rep.set(key, ref)
      // Cross-source rights conflict: same canonical URL, disagreeing FACTS (the
      // license label is not the trigger — see the note above factsKey). Resolve
      // conservatively; the resolved record replaces the representative's rights
      // below. Records making the same claim never conflict — differing
      // versions/authors are per-source metadata and the representative's own
      // record stays authoritative for them.
      const known = rights.get(key)
      if (known === undefined) {
        rights.set(key, ref.rights)
        return
      }
      const incoming = factsKey(factsOf(ref.rights))
      const claims = conflictFacts.get(key)
      if (claims) {
        if (!claims.has(incoming)) {
          claims.add(incoming)
          conflictLabels.get(key)!.add(ref.rights.license)
          rights.set(key, resolveRightsConflict(known, ref.rights))
        }
      } else if (compareRestrictiveness(factsOf(known), factsOf(ref.rights)) !== 'equal') {
        conflictFacts.set(key, new Set([factsKey(factsOf(known)), incoming]))
        conflictLabels.set(key, new Set([known.license, ref.rights.license]))
        rights.set(key, resolveRightsConflict(known, ref.rights))
      }
    })
  }

  // Report each conflicted URL once, with every source-declared id involved.
  if (opts.onRightsConflict) {
    for (const [key, labels] of conflictLabels) {
      opts.onRightsConflict({
        canonicalUrl: rep.get(key)!.canonicalUrl,
        licenses: [...labels],
        resolvedLicense: rights.get(key)!.license,
      })
    }
  }

  // Normalize by the actual max so the top result's relevance is exactly 1.0.
  // Reduce, not Math.max(...score.values()) — the merged pool can be large and a
  // spread of that many args overflows the call stack. RRF scores are fractional
  // (1/(k+rank) sums), so we keep the true max (no floor) to hit exactly 1.0. For
  // empty input score has no entries, so the .map body never runs and the seed
  // maxScore (-Infinity) is never used in the division.
  let maxScore = -Infinity
  for (const s of score.values()) if (s > maxScore) maxScore = s
  const fused: Reference[] = [...score.entries()]
    .map(([key, s]) => ({
      ...rep.get(key)!,
      // A conflicted key carries the conservatively-resolved rights instead of
      // whichever source happened to supply the representative.
      ...(conflictFacts.has(key) ? { rights: rights.get(key)! } : {}),
      relevance: s / maxScore,
    }))
    .sort((a, b) => b.relevance - a.relevance)

  // Perceptual-hash dedup as a second pass (URL dedup already happened via the key
  // map). No rights resolution here: perceptual duplicates from different sources
  // are DIFFERENT postings — each is a genuine offer under its own license, so
  // keeping the representative's license is correct, unlike the same-URL case.
  return dedupeReferences(fused, opts)
}
