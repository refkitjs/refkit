import { z } from 'zod'
import { CC_VERSIONED_FAMILIES, factsFor, type LicenseFacts, type LicenseId, type Tri } from './license'

export type RehostPolicy = 'hotlink-required' | 'cache-allowed' | 'thumbnail-only' | 'no-store'

// What a satellite emits per result. Permissions are derived from `license` via
// factsFor() unless the record ships its own `facts` (required for ids outside
// LICENSE_FACTS; an override for known ids whose source terms are narrower).
export interface RightsRecord {
  license: LicenseId
  /** Permission facts for this record. Read via factsOf(); never duplicated elsewhere. */
  facts?: LicenseFacts
  /** Precise CC version ("4.0", "3.0", …) for the six CC families only.
   *  Attribution/audit only — never read by evaluateUse. */
  licenseVersion?: string
  /** Per-item attribution datum; attribution text is generated, not stored. */
  author?: string
  rehostPolicy: RehostPolicy
  /** Source-declared jurisdiction of the PD/copyright status (e.g. 'US'). */
  jurisdiction?: string
  editorialOnly?: boolean
  /** Auditable anchor back to the source's stated terms. */
  raw: { sourceTerms: string; sourceUrl: string }
}

/** The facts that govern a record: its own row when supplied, else the table row. */
export function factsOf(r: Pick<RightsRecord, 'license' | 'facts'>): LicenseFacts {
  return r.facts ?? factsFor(r.license)
}

const triSchema: z.ZodType<Tri> = z.union([z.literal(true), z.literal(false), z.literal('unknown')])

export const licenseFactsSchema: z.ZodType<LicenseFacts> = z.object({
  commercialUse: triSchema,
  derivatives: triSchema,
  redistribution: triSchema,
  attributionRequired: z.boolean(),
  shareAlike: z.boolean(),
})

export const rightsRecordSchema: z.ZodType<RightsRecord> = z.object({
  license: z.string().min(1),
  facts: licenseFactsSchema.optional(),
  licenseVersion: z.string().optional(),
  author: z.string().optional(),
  rehostPolicy: z.enum(['hotlink-required', 'cache-allowed', 'thumbnail-only', 'no-store']),
  jurisdiction: z.string().optional(),
  editorialOnly: z.boolean().optional(),
  raw: z.object({ sourceTerms: z.string(), sourceUrl: z.string() }),
}).refine(
  r => r.licenseVersion === undefined || CC_VERSIONED_FAMILIES.has(r.license),
  { message: 'licenseVersion is only valid on a versioned CC family license' },
)
