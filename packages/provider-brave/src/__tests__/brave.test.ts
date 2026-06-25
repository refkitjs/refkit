import { describe, expect, it } from 'vitest'
import { evaluateUse, type ProviderContext } from '@refkit/core'
import { brave } from '../index'

const FIXTURE = {
  type: 'images',
  query: { original: 'hammerhead shark' },
  results: [
    {
      type: 'image_result',
      title: 'Hammerhead Shark',
      url: 'https://stock.adobe.com/search?k=hammerhead+shark',
      source: 'stock.adobe.com',
      page_fetched: '2025-02-28T23:32:43Z',
      thumbnail: { src: 'https://imgs.search.brave.com/abc/rs:fit:500:0:0:0/g:ce/aHR0.jpg' },
      properties: {
        url: 'https://t3.ftcdn.net/jpg/03/73/61/54/360_F_373615451_x.jpg',
        placeholder: 'https://imgs.search.brave.com/def/rs:fit:76:0:0:0/q:10/aHR0.jpg',
      },
      confidence: 'high',
    },
  ],
}

describe('brave provider', () => {
  it('maps a web result to a discovery Reference (license unknown, thumbnail-only)', async () => {
    let calledUrl = ''
    let token = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        calledUrl = String(input)
        token = String((init?.headers as Record<string, string>)['X-Subscription-Token'] ?? '')
        return new Response(JSON.stringify(FIXTURE), { status: 200 })
      }) as typeof fetch,
    }
    const refs = await brave({ token: 'SECRET' }).search({ text: 'sharks', modalities: ['image'] }, ctx)
    expect(token).toBe('SECRET')
    expect(calledUrl).toContain('api.search.brave.com')
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.rights.license).toBe('unknown')
    expect(r.rights.rehostPolicy).toBe('thumbnail-only')
    expect(r.canonicalUrl).toBe('https://stock.adobe.com/search?k=hammerhead+shark') // the source PAGE, not the image bytes
    expect(r.title).toBe('Hammerhead Shark')
    expect(r.thumbnail?.url).toBe('https://imgs.search.brave.com/abc/rs:fit:500:0:0:0/g:ce/aHR0.jpg')
    expect(r.id).toMatch(/^brave:/)
  })

  it('DISCOVERY moat: every web result is needs-review (never auto-allowed) for commercial use', async () => {
    const ctx: ProviderContext = { fetch: (async () => new Response(JSON.stringify(FIXTURE), { status: 200 })) as typeof fetch }
    const refs = await brave({ token: 'k' }).search({ text: 'x', modalities: ['image'] }, ctx)
    expect(evaluateUse(refs[0].rights, 'commercial-product').decision).toBe('needs-review')
    expect(evaluateUse(refs[0].rights, 'ai-generation-input').decision).toBe('needs-review')
  })

  it('maps unified safety controls to Brave safesearch', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await brave({ token: 't' }).search({ text: 'cat', modalities: ['image'], controls: { safety: 'off' } }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('safesearch')).toBe('off')
  })

  it('lets per-query strict safety override a factory off default', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await brave({ token: 't', safesearch: 'off' }).search({
      text: 'cat',
      modalities: ['image'],
      controls: { safety: 'strict' },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('safesearch')).toBe('strict')
  })

  it('lets per-query off safety override a factory strict default', async () => {
    let calledUrl = ''
    const ctx: ProviderContext = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        calledUrl = String(input)
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch,
    }
    await brave({ token: 't', safesearch: 'strict' }).search({
      text: 'cat',
      modalities: ['image'],
      controls: { safety: 'off' },
    }, ctx)
    const url = new URL(calledUrl)
    expect(url.searchParams.get('safesearch')).toBe('off')
  })
})
