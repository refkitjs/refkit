import { z } from 'zod'
import type { Modality } from './modality'
import { rightsRecordSchema, type RightsRecord } from './rights'

export interface ReferenceMedia { url: string; width?: number; height?: number }
export interface MediaPreview { url: string; mediaType: string; width?: number; height?: number }
export interface VisualMeta { width: number; height: number; dominantColors?: string[] }
export interface TextMeta {
  excerpt: string
  excerptKind: 'passage' | 'structure' | 'quote'
  locator?: string
}

export interface Reference {
  // content-addressed, stable within a single result set only (core is zero-storage).
  id: string
  modality: Modality
  title?: string
  // — provenance (required; a result missing any of these never enters the set) —
  source: { providerId: string; sourceUrl: string }
  canonicalUrl: string
  rights: RightsRecord
  verifiedAt: string // ISO; = the moment the satellite parsed rights (not a ToS-drift signal)
  // — carriers —
  thumbnail?: ReferenceMedia
  preview?: MediaPreview
  // computed by the satellite (pHash/blockhash); core only compares it, never decodes bytes.
  perceptualHash?: string
  // — modality-specific —
  visual?: VisualMeta
  text?: TextMeta
  // — retrieval —
  relevance: number // RRF fused score in 0..1; cross-source orderable, not absolute relevance
  raw?: unknown
}

const modalitySchema: z.ZodType<Modality> = z.enum(['image', 'video', 'audio', 'text'])

export const referenceSchema: z.ZodType<Reference> = z.object({
  id: z.string().min(1),
  modality: modalitySchema,
  title: z.string().optional(),
  source: z.object({ providerId: z.string().min(1), sourceUrl: z.string().min(1) }),
  canonicalUrl: z.string().min(1),
  rights: rightsRecordSchema,
  verifiedAt: z.string().datetime(),
  thumbnail: z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() }).optional(),
  preview: z.object({ url: z.string(), mediaType: z.string(), width: z.number().optional(), height: z.number().optional() }).optional(),
  perceptualHash: z.string().optional(),
  visual: z.object({ width: z.number(), height: z.number(), dominantColors: z.array(z.string()).optional() }).optional(),
  text: z.object({
    excerpt: z.string(),
    excerptKind: z.enum(['passage', 'structure', 'quote']),
    locator: z.string().optional(),
  }).optional(),
  relevance: z.number().min(0).max(1),
  raw: z.unknown().optional(),
})

/** Validate a provider-emitted reference at the core boundary. Throws on malformed input. */
export function parseReference(input: unknown): Reference {
  return referenceSchema.parse(input)
}
