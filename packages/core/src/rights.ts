import { z } from 'zod'
import type { LicenseId } from './license'

export type RehostPolicy = 'hotlink-required' | 'cache-allowed' | 'thumbnail-only' | 'no-store'

// What a satellite emits per result. Permissions are NOT stored here — they are
// derived from `license` via factsFor() (one source of truth). Only per-item data
// (author, rehost quirk, jurisdiction) and an auditable raw anchor live here.
export interface RightsRecord {
  license: LicenseId
  /** Precise CC version ("4.0", "3.0", …) for family ids (CC-BY/CC-BY-SA).
   *  Attribution/audit only — never read by evaluateUse. Omitted for non-CC. */
  licenseVersion?: string
  /** Per-item attribution datum; attribution text is generated, not stored. */
  author?: string
  rehostPolicy: RehostPolicy
  /** Source-declared jurisdiction of the PD/copyright status (e.g. 'US'). P0: metadata only. */
  jurisdiction?: string
  editorialOnly?: boolean
  /** Auditable anchor back to the source's stated terms. */
  raw: { sourceTerms: string; sourceUrl: string }
}

const licenseIdSchema: z.ZodType<LicenseId> = z.enum([
  'CC0-1.0', 'CC-BY', 'CC-BY-SA', 'PD',
  'unsplash', 'pexels', 'pixabay', 'proprietary', 'unknown',
])

export const rightsRecordSchema: z.ZodType<RightsRecord> = z.object({
  license: licenseIdSchema,
  licenseVersion: z.string().optional(),
  author: z.string().optional(),
  rehostPolicy: z.enum(['hotlink-required', 'cache-allowed', 'thumbnail-only', 'no-store']),
  jurisdiction: z.string().optional(),
  editorialOnly: z.boolean().optional(),
  raw: z.object({ sourceTerms: z.string(), sourceUrl: z.string() }),
})
