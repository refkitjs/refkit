import { z } from 'zod'
import type { Modality } from './modality'
import { rightsRecordSchema, type RightsRecord } from './rights'
import { referenceId } from './dedup-key'

export interface ReferenceMedia { url: string; width?: number; height?: number }
export interface MediaPreview { url: string; mediaType: string; width?: number; height?: number }
/** The original's pixel dimensions (image and video). An emitter that only knows
 *  a rendition's size leaves `visual` unset and puts that size on `preview`. */
export interface VisualMeta { width: number; height: number; dominantColors?: string[] }
export interface TextMeta {
  excerpt: string
  excerptKind: 'passage' | 'structure' | 'quote'
  locator?: string
}
export interface VideoMeta {
  /** Seconds, as a float. */
  durationSec?: number
  fps?: number
}
export interface AudioMeta {
  /** Seconds, as a float. */
  durationSec?: number
  /** Kilobits per second (bits/s ÷ 1000). */
  bitrateKbps?: number
  sampleRateHz?: number
  channels?: number
  /** Container/codec short name, e.g. 'mp3', 'flac'. */
  format?: string
}

/** Fields every variant carries, emitted or complete. */
interface CommonFields {
  /** Fine-grained kind (open vocabulary, see ResourceKind), e.g. 'photo', 'texture'. */
  kind?: string
  title?: string
  /** Free-text description from the source (caption, medium, synopsis…). Feeds ranking. */
  description?: string
  /** Source tags / subjects / categories. Feeds ranking. */
  tags?: string[]
  rights: RightsRecord
  /** An image a UI can show: the picture itself, a video poster, audio cover art
   *  or a book cover. Never a non-image URL (a landing page, JSON, an audio file). */
  thumbnail?: ReferenceMedia
  /** Upstream relevance score in the source's own scale; only the order within one
   *  source is meaningful. */
  sourceScore?: number
  raw?: unknown
}

interface ImageFields {
  /** The rehostable asset; mediaType is image/*. */
  preview?: MediaPreview
  visual?: VisualMeta
  /** Computed by the satellite (pHash/blockhash); core only compares it. */
  perceptualHash?: string
}
interface VideoFields {
  /** The playable asset; mediaType is video/*. */
  preview?: MediaPreview
  /** The source video's dimensions. */
  visual?: VisualMeta
  video?: VideoMeta
}
interface AudioFields {
  /** The playable asset; mediaType is audio/*. */
  preview?: MediaPreview
  audio?: AudioMeta
}
interface TextFields {
  text?: TextMeta
}

// A soft union: each variant declares the other variants' fields as `?: never`,
// so a provider writing a field that does not fit its modality gets a compile
// error, while a reader of the union still sees e.g. `r.visual` as
// `VisualMeta | undefined` without narrowing first.
type VariantKey = keyof ImageFields | keyof VideoFields | keyof AudioFields | keyof TextFields
type Absent<F> = { [K in Exclude<VariantKey, keyof F>]?: never }

/** What a provider emits next to the common fields: the landing page, and an
 *  optional canonical URL. */
interface EmittedTail {
  /** Landing page at the source. Also the canonical URL unless canonicalUrl is set. */
  sourceUrl: string
  canonicalUrl?: string
}
/** What core stamps onto an emitted item (see completeReference). */
interface StampedTail {
  /** Content-addressed: `${sourceId}:${hash(sourceUrl)}`; stable within a result set. */
  id: string
  /** Where this reference came from: the source's id (`provider.id`, what `sources`
   *  and `meta.sources` speak) and the landing page at that source. */
  source: { id: string; url: string }
  canonicalUrl: string
  /** ISO; the moment the satellite's output was parsed. */
  verifiedAt: string
  /** 0..1, meaningful only after merge (RRF) or rerank; providers never set it. */
  relevance: number
}

export interface EmittedImageReference extends CommonFields, EmittedTail, ImageFields, Absent<ImageFields> { modality: 'image' }
export interface EmittedVideoReference extends CommonFields, EmittedTail, VideoFields, Absent<VideoFields> { modality: 'video' }
export interface EmittedAudioReference extends CommonFields, EmittedTail, AudioFields, Absent<AudioFields> { modality: 'audio' }
export interface EmittedTextReference extends CommonFields, EmittedTail, TextFields, Absent<TextFields> { modality: 'text' }

/** What a provider emits for one result: everything the SOURCE knows, as the
 *  variant of its modality. Core stamps id, source, verifiedAt and relevance (see
 *  completeReference) — providers never write those, never post-truncate, and
 *  never compute ids. */
export type EmittedReference =
  | EmittedImageReference
  | EmittedVideoReference
  | EmittedAudioReference
  | EmittedTextReference

export interface ImageReference extends CommonFields, StampedTail, ImageFields, Absent<ImageFields> { modality: 'image' }
export interface VideoReference extends CommonFields, StampedTail, VideoFields, Absent<VideoFields> { modality: 'video' }
export interface AudioReference extends CommonFields, StampedTail, AudioFields, Absent<AudioFields> { modality: 'audio' }
export interface TextReference extends CommonFields, StampedTail, TextFields, Absent<TextFields> { modality: 'text' }

/** A complete reference: the emitted variant without sourceUrl/canonicalUrl, plus
 *  the core-stamped fields. A type alias of a union, so `Omit<Reference, K>` loses
 *  the link between `modality` and its fields (use a distributive omit), and an
 *  interface can no longer `extend` it. */
export type Reference = ImageReference | VideoReference | AudioReference | TextReference

const mediaSchema = z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() })
const previewOf = (prefix: 'image/' | 'video/' | 'audio/') => z.object({
  url: z.string(),
  mediaType: z.string().startsWith(prefix, { message: `preview.mediaType must start with "${prefix}"` }),
  width: z.number().optional(),
  height: z.number().optional(),
})
const visualSchema = z.object({ width: z.number(), height: z.number(), dominantColors: z.array(z.string()).optional() })
const textSchema = z.object({ excerpt: z.string(), excerptKind: z.enum(['passage', 'structure', 'quote']), locator: z.string().optional() })
const videoMetaSchema = z.object({ durationSec: z.number().optional(), fps: z.number().optional() })
const audioMetaSchema = z.object({
  durationSec: z.number().optional(),
  bitrateKbps: z.number().optional(),
  sampleRateHz: z.number().optional(),
  channels: z.number().optional(),
  format: z.string().optional(),
})

const commonShape = {
  kind: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rights: rightsRecordSchema,
  thumbnail: mediaSchema.optional(),
  sourceScore: z.number().optional(),
  raw: z.unknown().optional(),
}

// The one table of per-modality fields. A key missing here fails to compile.
const VARIANT_SHAPES = {
  image: { preview: previewOf('image/').optional(), visual: visualSchema.optional(), perceptualHash: z.string().optional() },
  video: { preview: previewOf('video/').optional(), visual: visualSchema.optional(), video: videoMetaSchema.optional() },
  audio: { preview: previewOf('audio/').optional(), audio: audioMetaSchema.optional() },
  text: { text: textSchema.optional() },
} satisfies Record<Modality, z.ZodRawShape>

const emittedTail = { sourceUrl: z.string().min(1), canonicalUrl: z.string().min(1).optional() }
const stampedTail = {
  id: z.string().min(1),
  source: z.object({ id: z.string().min(1), url: z.string().min(1) }),
  canonicalUrl: z.string().min(1),
  verifiedAt: z.string().datetime(),
  relevance: z.number().min(0).max(1),
}

// Unknown keys are stripped (plain z.object): a field from another modality
// disappears at the boundary instead of rejecting the item. The provider testkit
// asserts that parseEmitted lost no keys, so a provider writing one fails its
// own conformance tests.
function variant<M extends Modality, T extends z.ZodRawShape>(m: M, tail: T) {
  return z.object({ modality: z.literal(m), ...commonShape, ...VARIANT_SHAPES[m], ...tail })
}

// One explicit call per modality: MODALITIES.map does not type-check as the
// non-empty tuple discriminatedUnion needs.
export const emittedReferenceSchema: z.ZodType<EmittedReference> = z.discriminatedUnion('modality', [
  variant('image', emittedTail),
  variant('video', emittedTail),
  variant('audio', emittedTail),
  variant('text', emittedTail),
])

export const referenceSchema: z.ZodType<Reference> = z.discriminatedUnion('modality', [
  variant('image', stampedTail),
  variant('video', stampedTail),
  variant('audio', stampedTail),
  variant('text', stampedTail),
])

/** Validate a provider-emitted item at the core boundary. Throws on malformed input. */
export function parseEmitted(input: unknown): EmittedReference {
  return emittedReferenceSchema.parse(input)
}

/** Validate a complete reference (cache hits, host-supplied refs). */
export function parseReference(input: unknown): Reference {
  return referenceSchema.parse(input)
}

/** Stamp the fields that are core's concern onto an emitted item. The rest-spread
 *  keeps the discriminant: the result narrows on `modality` like its input. */
export function completeReference(sourceId: string, e: EmittedReference, now: string): Reference {
  const { sourceUrl, canonicalUrl, ...rest } = e
  return {
    ...rest,
    id: referenceId(sourceId, sourceUrl),
    source: { id: sourceId, url: sourceUrl },
    canonicalUrl: canonicalUrl ?? sourceUrl,
    verifiedAt: now,
    relevance: 0,
  }
}
