import { describe, expect, it } from 'vitest'
import { searchConformant } from '@refkit/provider-testkit'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { nailbook } from '../index'
import fixture from './fixtures/photo-search.json'

// A real (trimmed) `/api/web/photo/search` response captured live for keyword
// "マグネット": item 0 single-image, item 1 multi-image, item 2 carries a video on a
// later image, item 3 has an empty caption (exercises the tag-name title fallback).
type Json = Record<string, unknown>

/** Stub fetch that records the outgoing request and replies with `payload`. */
function recordingCtx(payload: unknown): { ctx: ProviderContext; seen: { url?: string; init?: RequestInit } } {
  const seen: { url?: string; init?: RequestInit } = {}
  const ctx: ProviderContext = {
    fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.url = String(input)
      seen.init = init
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch,
  }
  return { ctx, seen }
}

const okCtx = () => recordingCtx(fixture).ctx

describe('nailbook provider', () => {
  it('passes provider conformance on real API data', async () => {
    const refs = await searchConformant(nailbook(), okCtx().fetch, { query: 'マグネット' })
    expect(refs).toHaveLength(4)
    expect(refs.every(r => r.id.startsWith('nailbook:'))).toBe(true)
    expect(refs.every(r => r.modality === 'image')).toBe(true)
  })

  it('POSTs the keyword as JSON to the photo-search endpoint', async () => {
    const { ctx, seen } = recordingCtx(fixture)
    await nailbook().search({ text: 'マグネット', modalities: ['image'] }, ctx)
    expect(seen.url).toBe('https://nailbook.jp/api/web/photo/search')
    expect(seen.init?.method).toBe('POST')
    const headers = seen.init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json') // load-bearing: else HTTP 400
    expect(headers['X-Requested-With']).toBe('XMLHttpRequest')
    expect(JSON.parse(String(seen.init?.body))).toEqual({ keyword: 'マグネット' })
  })

  it('maps a photo to a discovery-class image reference', async () => {
    const refs = await nailbook().search({ text: 'マグネット', modalities: ['image'] }, okCtx())
    const r = refs[0]
    expect(r.canonicalUrl).toBe('https://nailbook.jp/design/10049726/')
    expect(r.source).toEqual({ providerId: 'nailbook', sourceUrl: 'https://nailbook.jp/design/10049726/' })
    expect(r.thumbnail?.url).toBe('https://cnv.nailbook.jp/photo/35052322/320_lc')
    expect(r.preview).toEqual({ url: 'https://cnv.nailbook.jp/photo/35052322/1280_lc', mediaType: 'image/jpeg' })
    expect(r.visual).toEqual({ width: 2727, height: 2727 })
    expect(r.title).toContain('マグネット')
    expect(r.rights.license).toBe('unknown')
    expect(r.rights.rehostPolicy).toBe('thumbnail-only')
    expect(r.rights.author).toBe('china')
    expect(r.rights.raw).toEqual({ sourceTerms: '', sourceUrl: 'https://nailbook.jp/design/10049726/' })
  })

  it('unknown license → needs-review under any commercial intent', async () => {
    const refs = await nailbook().search({ text: 'x', modalities: ['image'] }, okCtx())
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('needs-review')
  })

  it('uses the primary image for multi-image and video-bearing photos', async () => {
    const refs = await nailbook().search({ text: 'x', modalities: ['image'] }, okCtx())
    // item 1 has two images — the first one wins
    expect(refs[1].thumbnail?.url).toBe('https://cnv.nailbook.jp/photo/35052312/320_lc')
    // item 2 has a video on a later image, but images[0] is a still — thumbnail must be
    // an image variant, never the /video/ URL
    expect(refs[2].thumbnail?.url).toBe('https://cnv.nailbook.jp/photo/35052000/320_lc')
    expect(refs[2].thumbnail?.url).not.toContain('/video/')
  })

  it('falls back to tag labels when the caption is empty', async () => {
    const refs = await nailbook().search({ text: 'x', modalities: ['image'] }, okCtx())
    expect(refs[3].title).toBe('マグネット / ブラウン / ゴールド')
  })

  it('drops photos with no primary image', async () => {
    const noImage = { ...(fixture as Json), data: { ...(fixture as { data: Json }).data, items: [
      { id: 999, memo: null, price: null, kawaii_count: 0, create_datetime: '2026-07-24 00:00:00', images: [], user: null, tags: [] },
    ] } }
    const refs = await nailbook().search({ text: 'x', modalities: ['image'] }, recordingCtx(noImage).ctx)
    expect(refs).toEqual([])
  })

  it('respects the requested limit', async () => {
    const refs = await nailbook().search({ text: 'x', modalities: ['image'], limit: 2 }, okCtx())
    expect(refs).toHaveLength(2)
  })

  it('returns [] on an empty result set', async () => {
    const empty = { data: { total_count: 0, scrolling_key: null, items: [] }, result: true, status_code: 200 }
    const refs = await nailbook().search({ text: 'zzz', modalities: ['image'] }, recordingCtx(empty).ctx)
    expect(refs).toEqual([])
  })
})
