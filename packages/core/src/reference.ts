import { z } from 'zod'
import { MODALITIES, type Modality } from './modality'
import { rightsRecordSchema, type RightsRecord } from './rights'
import { referenceId } from './dedup-key'

export interface ReferenceMedia { url: string; width?: number; height?: number }
export interface MediaPreview { url: string; mediaType: string; width?: number; height?: number }
export interface VisualMeta { width: number; height: number; dominantColors?: string[] }
export interface TextMeta {
  excerpt: string
  excerptKind: 'passage' | 'structure' | 'quote'
  locator?: string
}

/** What a provider emits for one result: everything the SOURCE knows. Core stamps
 *  id, source, verifiedAt and relevance (see completeReference) — providers never
 *  write those, never post-truncate, and never compute ids. */
export interface EmittedReference {
  modality: Modality
  /** Fine-grained kind (open vocabulary, see ResourceKind), e.g. 'photo', 'texture'. */
  kind?: string
  title?: string
  /** Free-text description from the source (caption, medium, synopsis…). Feeds ranking. */
  description?: string
  /** Source tags / subjects / categories. Feeds ranking. */
  tags?: string[]
  /** Landing page at the source. Also the canonical URL unless canonicalUrl is set. */
  sourceUrl: string
  canonicalUrl?: string
  rights: RightsRecord
  thumbnail?: ReferenceMedia
  preview?: MediaPreview
  /** Computed by the satellite (pHash/blockhash); core only compares it. */
  perceptualHash?: string
  visual?: VisualMeta
  text?: TextMeta
  /** Upstream relevance score in the source's own scale; only the order within one
   *  source is meaningful. */
  sourceScore?: number
  raw?: unknown
}

export interface Reference extends Omit<EmittedReference, 'sourceUrl' | 'canonicalUrl'> {
  /** Content-addressed: `${providerId}:${hash(sourceUrl)}`; stable within a result set. */
  id: string
  source: { providerId: string; sourceUrl: string }
  canonicalUrl: string
  /** ISO; the moment the satellite's output was parsed. */
  verifiedAt: string
  /** 0..1, meaningful only after merge (RRF) or rerank; providers never set it. */
  relevance: number
}

const modalitySchema: z.ZodType<Modality> = z.enum(MODALITIES)
const mediaSchema = z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() })
const previewSchema = z.object({ url: z.string(), mediaType: z.string(), width: z.number().optional(), height: z.number().optional() })
const visualSchema = z.object({ width: z.number(), height: z.number(), dominantColors: z.array(z.string()).optional() })
const textSchema = z.object({ excerpt: z.string(), excerptKind: z.enum(['passage', 'structure', 'quote']), locator: z.string().optional() })

const emittedFields = {
  modality: modalitySchema,
  kind: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rights: rightsRecordSchema,
  thumbnail: mediaSchema.optional(),
  preview: previewSchema.optional(),
  perceptualHash: z.string().optional(),
  visual: visualSchema.optional(),
  text: textSchema.optional(),
  sourceScore: z.number().optional(),
  raw: z.unknown().optional(),
}

export const emittedReferenceSchema: z.ZodType<EmittedReference> = z.object({
  ...emittedFields,
  sourceUrl: z.string().min(1),
  canonicalUrl: z.string().min(1).optional(),
})

export const referenceSchema: z.ZodType<Reference> = z.object({
  ...emittedFields,
  id: z.string().min(1),
  source: z.object({ providerId: z.string().min(1), sourceUrl: z.string().min(1) }),
  canonicalUrl: z.string().min(1),
  verifiedAt: z.string().datetime(),
  relevance: z.number().min(0).max(1),
})

/** Validate a provider-emitted item at the core boundary. Throws on malformed input. */
export function parseEmitted(input: unknown): EmittedReference {
  return emittedReferenceSchema.parse(input)
}

/** Validate a complete reference (cache hits, host-supplied refs). */
export function parseReference(input: unknown): Reference {
  return referenceSchema.parse(input)
}

/** Stamp the fields that are core's concern onto an emitted item. */
export function completeReference(providerId: string, e: EmittedReference, now: string): Reference {
  const { sourceUrl, canonicalUrl, ...rest } = e
  return {
    ...rest,
    id: referenceId(providerId, sourceUrl),
    source: { providerId, sourceUrl },
    canonicalUrl: canonicalUrl ?? sourceUrl,
    verifiedAt: now,
    relevance: 0,
  }
}
