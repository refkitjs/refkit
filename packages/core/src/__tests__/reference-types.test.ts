import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  completeReference, parseEmitted,
  type AudioMeta, type AudioReference, type EmittedAudioReference, type EmittedImageReference,
  type EmittedReference, type EmittedTextReference, type EmittedVideoReference, type ImageReference,
  type MediaPreview, type Modality, type Reference, type RightsRecord, type TextMeta, type TextReference,
  type VideoMeta, type VideoReference, type VisualMeta,
} from '../index'

// Type tests. tsc (`pnpm typecheck`) is the real runner: a wrong expectTypeOf
// is a compile error, and so is an @ts-expect-error line that stops erroring.
// vitest only executes the bodies, which also check the runtime values.

const rights: RightsRecord = {
  license: 'CC0-1.0', rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'https://x/1' },
}
const base = { sourceUrl: 'https://x/1', rights }
const visualMeta: VisualMeta = { width: 640, height: 480 }
const imagePreview: MediaPreview = { url: 'https://x/1.jpg', mediaType: 'image/jpeg' }
const videoPreview: MediaPreview = { url: 'https://x/1.mp4', mediaType: 'video/mp4' }
const audioPreview: MediaPreview = { url: 'https://x/1.mp3', mediaType: 'audio/mpeg' }
const textMeta: TextMeta = { excerpt: 'e', excerptKind: 'passage' }
const videoMeta: VideoMeta = { durationSec: 12, fps: 25 }
const audioMeta: AudioMeta = { durationSec: 2.5, bitrateKbps: 128, sampleRateHz: 44100, channels: 2, format: 'mp3' }

// Sinks: a call checks a literal against the target type the way a provider's
// `return [{ … }]` is checked against EmittedReference[].
const image = (r: EmittedImageReference) => r
const video = (r: EmittedVideoReference) => r
const audio = (r: EmittedAudioReference) => r
const text = (r: EmittedTextReference) => r
const emitted = (r: EmittedReference) => r
const emittedAll = (r: EmittedReference[]) => r
const complete = (r: Reference) => r

describe('Reference variants (types)', () => {
  it('the unions are exactly the four named variants', () => {
    expectTypeOf<EmittedReference>().toEqualTypeOf<
      EmittedImageReference | EmittedVideoReference | EmittedAudioReference | EmittedTextReference
    >()
    expectTypeOf<Reference>().toEqualTypeOf<ImageReference | VideoReference | AudioReference | TextReference>()
  })

  it('the discriminant covers every modality, so a new one cannot be half-added', () => {
    expectTypeOf<EmittedReference['modality']>().toEqualTypeOf<Modality>()
    expectTypeOf<Reference['modality']>().toEqualTypeOf<Modality>()
  })

  it('each variant accepts its own fields', () => {
    const all = [
      image({ modality: 'image', ...base, preview: imagePreview, visual: visualMeta, perceptualHash: 'ff00' }),
      video({ modality: 'video', ...base, preview: videoPreview, visual: visualMeta, video: videoMeta }),
      audio({ modality: 'audio', ...base, preview: audioPreview, audio: audioMeta }),
      text({ modality: 'text', ...base, text: textMeta }),
    ]
    // thumbnail is common: a picture, a poster, cover art, a book cover.
    for (const r of all) emitted({ ...r, thumbnail: { url: 'https://x/t.jpg' } })
    expect(all.map(r => r.modality)).toEqual(['image', 'video', 'audio', 'text'])
  })

  it('an image rejects video, audio and text fields', () => {
    // @ts-expect-error video metadata does not fit an image
    image({ modality: 'image', ...base, video: videoMeta })
    // @ts-expect-error audio metadata does not fit an image
    image({ modality: 'image', ...base, audio: audioMeta })
    // @ts-expect-error a text excerpt does not fit an image
    image({ modality: 'image', ...base, text: textMeta })
  })

  it('a video rejects perceptualHash, audio and text fields', () => {
    // @ts-expect-error perceptualHash is image-only
    video({ modality: 'video', ...base, perceptualHash: 'ff00' })
    // @ts-expect-error audio metadata does not fit a video
    video({ modality: 'video', ...base, audio: audioMeta })
    // @ts-expect-error a text excerpt does not fit a video
    video({ modality: 'video', ...base, text: textMeta })
  })

  it('an audio ref rejects visual, video, perceptualHash and text fields', () => {
    // @ts-expect-error audio has no pixel dimensions
    audio({ modality: 'audio', ...base, visual: visualMeta })
    // @ts-expect-error video metadata does not fit audio
    audio({ modality: 'audio', ...base, video: videoMeta })
    // @ts-expect-error perceptualHash is image-only
    audio({ modality: 'audio', ...base, perceptualHash: 'ff00' })
    // @ts-expect-error a text excerpt does not fit audio
    audio({ modality: 'audio', ...base, text: textMeta })
  })

  it('a text ref rejects preview, visual, video, audio and perceptualHash fields', () => {
    // @ts-expect-error text has no media preview
    text({ modality: 'text', ...base, preview: imagePreview })
    // @ts-expect-error text has no pixel dimensions
    text({ modality: 'text', ...base, visual: visualMeta })
    // @ts-expect-error video metadata does not fit text
    text({ modality: 'text', ...base, video: videoMeta })
    // @ts-expect-error audio metadata does not fit text
    text({ modality: 'text', ...base, audio: audioMeta })
    // @ts-expect-error perceptualHash is image-only
    text({ modality: 'text', ...base, perceptualHash: 'ff00' })
  })

  it('the union rejects a wrong field once the literal modality picks the variant', () => {
    // @ts-expect-error visual on audio, written the way a provider writes it
    emitted({ modality: 'audio', ...base, visual: visualMeta })
    // @ts-expect-error audio metadata on a video
    emitted({ modality: 'video', ...base, audio: audioMeta })
    // @ts-expect-error the complete Reference rejects it too
    complete({ modality: 'text', id: 'p:1', source: { providerId: 'p', sourceUrl: 'https://x/1' }, canonicalUrl: 'https://x/1', rights, verifiedAt: '2026-01-01T00:00:00.000Z', relevance: 0, visual: visualMeta })
  })

  it('the `?: never` fields catch what excess-property checks miss (non-fresh objects, map callbacks)', () => {
    const rows = [1]
    // @ts-expect-error visual on audio, built in a map callback as providers do
    emittedAll(rows.map(() => ({ modality: 'audio' as const, ...base, visual: visualMeta })))
    // @ts-expect-error a text excerpt on an image, built in a map callback
    emittedAll(rows.map(() => ({ modality: 'image' as const, ...base, text: textMeta })))
    // @ts-expect-error audio metadata on a video, built in a map callback
    emittedAll(rows.map(() => ({ modality: 'video' as const, ...base, audio: audioMeta })))
    // @ts-expect-error a preview on text, built in a map callback
    emittedAll(rows.map(() => ({ modality: 'text' as const, ...base, preview: imagePreview })))
    const built = { modality: 'audio' as const, ...base, video: videoMeta }
    // @ts-expect-error a non-fresh audio object carrying video metadata
    audio(built)
  })

  it('a Modality-typed variable with common fields only still compiles (internet-archive)', () => {
    const m = 'video' as Modality
    expect(emitted({ modality: m, ...base, kind: 'film' }).modality).toBe('video')
  })

  it('readers of the union see each field as optional, of its own type', () => {
    expectTypeOf<EmittedReference['visual']>().toEqualTypeOf<VisualMeta | undefined>()
    expectTypeOf<EmittedReference['text']>().toEqualTypeOf<TextMeta | undefined>()
    expectTypeOf<EmittedReference['audio']>().toEqualTypeOf<AudioMeta | undefined>()
    expectTypeOf<EmittedReference['video']>().toEqualTypeOf<VideoMeta | undefined>()
    expectTypeOf<EmittedReference['preview']>().toEqualTypeOf<MediaPreview | undefined>()
    expectTypeOf<EmittedReference['perceptualHash']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Reference['visual']>().toEqualTypeOf<VisualMeta | undefined>()
    expectTypeOf<Reference['text']>().toEqualTypeOf<TextMeta | undefined>()
    expectTypeOf<Reference['audio']>().toEqualTypeOf<AudioMeta | undefined>()
    expectTypeOf<Reference['video']>().toEqualTypeOf<VideoMeta | undefined>()
    expectTypeOf<Reference['preview']>().toEqualTypeOf<MediaPreview | undefined>()
    expectTypeOf<Reference['perceptualHash']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Pick<Reference, 'title' | 'text'>>().toEqualTypeOf<{ title?: string; text?: TextMeta }>()
  })

  it('a complete variant drops sourceUrl and requires the core-stamped fields', () => {
    expectTypeOf<ImageReference>().not.toHaveProperty('sourceUrl')
    expectTypeOf<Reference['canonicalUrl']>().toEqualTypeOf<string>()
    expectTypeOf<Reference['id']>().toEqualTypeOf<string>()
    expectTypeOf<Reference['relevance']>().toEqualTypeOf<number>()
  })
})

describe('completeReference keeps the discriminant (types)', () => {
  const now = '2026-01-01T00:00:00.000Z'

  it('returns a Reference', () => {
    expectTypeOf(completeReference).returns.toEqualTypeOf<Reference>()
  })

  it('narrows to the audio variant on modality, and the audio metadata survives', () => {
    const r = completeReference('p', parseEmitted({ modality: 'audio', ...base, audio: audioMeta }), now)
    if (r.modality !== 'audio') throw new Error(`modality lost: ${r.modality}`)
    expectTypeOf(r).toEqualTypeOf<AudioReference>()
    expectTypeOf(r.audio).toEqualTypeOf<AudioMeta | undefined>()
    expect(r.audio).toEqual(audioMeta)
  })

  it('narrows to the video variant from a typed emitted variant', () => {
    const e: EmittedVideoReference = { modality: 'video', ...base, visual: visualMeta, video: videoMeta }
    const r = completeReference('p', e, now)
    if (r.modality !== 'video') throw new Error(`modality lost: ${r.modality}`)
    expectTypeOf(r).toEqualTypeOf<VideoReference>()
    expectTypeOf(r.video).toEqualTypeOf<VideoMeta | undefined>()
    expect(r.video).toEqual(videoMeta)
    expect(r.visual).toEqual(visualMeta)
  })

  it('narrows to the text variant', () => {
    const r = completeReference('p', { modality: 'text', ...base, text: textMeta }, now)
    if (r.modality !== 'text') throw new Error(`modality lost: ${r.modality}`)
    expectTypeOf(r).toEqualTypeOf<TextReference>()
    expect(r.text).toEqual(textMeta)
  })
})
