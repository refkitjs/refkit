import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRefkit, evaluateUse, type ProviderContext } from '@refkit/core'
import { polyhaven } from '../index'

// Poly Haven: /assets returns id→asset (no URLs); /files/<id> returns the download tree.
const ctxRouting = (list: unknown, files: Record<string, unknown>): ProviderContext => ({
  fetch: (async (input: string) => {
    const u = String(input)
    if (u.includes('/assets')) return new Response(JSON.stringify(list), { status: 200 })
    const m = u.match(/\/files\/([^/?]+)/)
    if (m && files[m[1]]) return new Response(JSON.stringify(files[m[1]]), { status: 200 })
    return new Response('null', { status: 404 })
  }) as typeof fetch,
})

const LIST = {
  aerial_asphalt_01: {
    type: 1, name: 'Aerial Asphalt 01', categories: ['asphalt', 'road'], tags: ['flat'],
    authors: { 'Rob Tuytel': 'All' },
    thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/aerial_asphalt_01.png?width=256&height=256',
  },
  // Three more assets so a multi-word query can match per token and rank by how
  // many of them a single asset covers.
  forest_floor: { type: 1, name: 'Forest Floor', tags: ['forest', 'ground'] },
  brick_wall: { type: 1, name: 'Brick Wall', tags: ['brick'] },
  mossy_forest_rock: { type: 1, name: 'Mossy Forest Rock', tags: ['forest', 'rock', 'moss'] },
}
const FILES_TEX = {
  aerial_asphalt_01: {
    Diffuse: {
      '1k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_asphalt_01/aerial_asphalt_01_diff_1k.jpg' } },
    },
    // non-image keys that must be ignored:
    blend: { '1k': { blend: { url: 'https://dl.polyhaven.org/x.blend' } } },
    gltf: { '1k': { gltf: { url: 'https://dl.polyhaven.org/x.gltf' } } },
  },
  forest_floor: { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/forest_floor_diff_1k.jpg' } } } },
  brick_wall: { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/brick_wall_diff_1k.jpg' } } } },
  mossy_forest_rock: { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/mossy_forest_rock_diff_1k.jpg' } } } },
}

describe('polyhaven provider', () => {
  it('maps a texture to a CC0 image reference with a resolved jpg preview', async () => {
    const refs = await polyhaven().search(
      { text: 'asphalt', modalities: ['image'], limit: 5 },
      ctxRouting(LIST, FILES_TEX),
    )
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('image')
    expect(r.title).toBe('Aerial Asphalt 01')
    expect(r.tags).toEqual(['asphalt', 'road', 'flat']) // categories then tags
    expect(r.rights.license).toBe('CC0-1.0')
    expect(r.rights.author).toBe('Rob Tuytel')
    expect(r.rights.rehostPolicy).toBe('cache-allowed')
    expect(r.rights.raw.sourceTerms).toBe('https://polyhaven.com/license')
    expect(r.preview?.url).toContain('aerial_asphalt_01_diff_1k.jpg')
    expect(r.preview?.mediaType).toBe('image/jpeg')
    expect(r.thumbnail?.url).toContain('thumbs/aerial_asphalt_01.png')
    expect(r.sourceUrl).toBe('https://polyhaven.com/a/aerial_asphalt_01')
    expect(evaluateUse(r.rights, 'commercial-product').decision).toBe('allowed')
  })

  it('returns [] when the list is empty', async () => {
    const refs = await polyhaven().search({ text: 'zzz', modalities: ['image'] }, ctxRouting({}, {}))
    expect(refs).toEqual([])
  })

  it('matches each query token independently and ranks by matched tokens', async () => {
    const refs = await polyhaven().search({ text: 'forest rock', modalities: ['image'] }, ctxRouting(LIST, FILES_TEX))
    expect(refs.map(r => r.sourceUrl)).toEqual(['https://polyhaven.com/a/mossy_forest_rock', 'https://polyhaven.com/a/forest_floor'])
  })

  it('tokenises on punctuation, not just whitespace — "forest, rock." matches the same assets as "forest rock"', async () => {
    const [withPunctuation, withSpace] = await Promise.all([
      polyhaven().search({ text: 'forest, rock.', modalities: ['image'] }, ctxRouting(LIST, FILES_TEX)),
      polyhaven().search({ text: 'forest rock', modalities: ['image'] }, ctxRouting(LIST, FILES_TEX)),
    ])
    expect(withPunctuation.map(r => r.sourceUrl)).toEqual(withSpace.map(r => r.sourceUrl))
  })

  it('declares kinds per assetType', () => {
    expect(polyhaven().kinds).toEqual(['texture'])
    expect(polyhaven({ assetType: 'hdris' }).kinds).toEqual(['hdri'])
  })

  it('serves HDRIs as their own source, polyhaven-hdri, so textures and HDRIs can coexist', () => {
    expect(polyhaven().id).toBe('polyhaven')
    expect(polyhaven({ assetType: 'textures' }).id).toBe('polyhaven')
    expect(polyhaven({ assetType: 'hdris' }).id).toBe('polyhaven-hdri')
    // createRefkit throws on duplicate source ids
    const refkit = createRefkit({ providers: [polyhaven(), polyhaven({ assetType: 'hdris' })] })
    expect(refkit.providers.map(p => p.id)).toEqual(['polyhaven', 'polyhaven-hdri'])
  })
})

// — relevance ranking —

// HDRI fixtures: /files/<id> answers every id with a tonemapped preview, so the
// ranking alone decides what comes back, in what order.
const hdriCtx = (list: unknown): ProviderContext => ({
  fetch: (async (input: string) => {
    const u = String(input)
    if (u.includes('/assets')) return new Response(JSON.stringify(list), { status: 200 })
    const m = u.match(/\/files\/([^/?]+)/)
    return new Response(JSON.stringify({ tonemapped: { url: `https://dl.polyhaven.org/${m?.[1]}.jpg` } }), { status: 200 })
  }) as typeof fetch,
})
const ids = (refs: { sourceUrl: string }[]) => refs.map(r => r.sourceUrl.replace('https://polyhaven.com/a/', ''))
const hdriSearch = (list: unknown, text: string, extra: object = {}, config: object = {}) =>
  polyhaven({ assetType: 'hdris', ...config }).search({ text, modalities: ['image'], ...extra }, hdriCtx(list))

describe('polyhaven relevance ranking', () => {
  // The list endpoint serves assets alphabetically by id; every fixture puts the
  // less relevant asset first so list order and relevance disagree.
  it('ranks an exact tag or category word above a substring-only match ("sunset HDRI")', async () => {
    const list = {
      amber_sunsets: { type: 0, name: 'Amber Sunsets', categories: ['outdoor'], download_count: 900_000 }, // "sunset" only inside "sunsets"
      brick_studio: { type: 0, name: 'Brick Studio', categories: ['indoor'] }, // matches nothing
      zwartkops_evening: { type: 0, name: 'Zwartkops Evening', categories: ['outdoor', 'sunrise-sunset'], download_count: 10 },
    }
    // "hdri" matches no asset and adds nothing; a non-matching asset stays out.
    expect(ids(await hdriSearch(list, 'sunset HDRI'))).toEqual(['zwartkops_evening', 'amber_sunsets'])
  })

  it('ranks a word of the name or id above a tag or category word, whatever the downloads', async () => {
    const list = {
      alpine_meadow: { type: 0, name: 'Alpine Meadow', categories: ['sunrise-sunset'], tags: ['sunset'], download_count: 800_000 },
      sunset_jhbcentral: { type: 0, name: 'JHB Central', categories: ['urban'], download_count: 1 }, // word of the id only
      venice_sunset: { type: 0, name: 'Venice Sunset', categories: ['urban'], download_count: 5 },
    }
    expect(ids(await hdriSearch(list, 'sunset'))).toEqual(['venice_sunset', 'sunset_jhbcentral', 'alpine_meadow'])
  })

  it('counts each token once, at its best match, not once per field it appears in', async () => {
    const list = {
      // "sunset" is in the name, a category word and a tag: still worth 3, not 3+2+2
      aa_sunset_peak: { type: 0, name: 'Sunset Peak', categories: ['sunrise-sunset'], tags: ['sunset'], download_count: 10 },
      bb_sunset_bay: { type: 0, name: 'Sunset Bay', download_count: 20 },
    }
    expect(ids(await hdriSearch(list, 'sunset'))).toEqual(['bb_sunset_bay', 'aa_sunset_peak'])
  })

  it('breaks equal scores by download_count (missing counts as 0), then by list order', async () => {
    const list = {
      aarfontein_dawn_2: { type: 0, name: 'Aarfontein Dawn 2', categories: ['sunrise-sunset'] }, // no download_count
      lilienstein: { type: 0, name: 'Lilienstein', categories: ['sunrise-sunset'], download_count: 769_081 },
      spruit_sunrise: { type: 0, name: 'Spruit Sunrise', categories: ['sunrise-sunset'], download_count: 551_025 },
      the_sky_is_on_fire: { type: 0, name: 'The Sky Is On Fire', categories: ['sunrise-sunset'], download_count: 551_025 },
    }
    expect(ids(await hdriSearch(list, 'sunset HDRI'))).toEqual(['lilienstein', 'spruit_sunrise', 'the_sky_is_on_fire', 'aarfontein_dawn_2'])
  })

  it('windows pages over the ranked list, not the list order', async () => {
    // a..e listed in that order, popularity rising: ranked order is e, d, c, b, a
    const list = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      [`${id}_dusk`, { type: 0, name: `${id.toUpperCase()} Dusk`, categories: ['sunrise-sunset'], download_count: (i + 1) * 100 }]))
    const page = (n: number) => hdriSearch(list, 'sunset', { controls: { page: n } }, { maxAssets: 2 })
    expect(ids(await page(1))).toEqual(['e_dusk', 'd_dusk'])
    expect(ids(await page(2))).toEqual(['c_dusk', 'b_dusk'])
    expect(ids(await page(3))).toEqual(['a_dusk'])
  })

  it('keeps every asset for a query with no tokens, most-downloaded first', async () => {
    const list = {
      a_room: { type: 0, name: 'A Room', download_count: 5 },
      b_room: { type: 0, name: 'B Room' }, // no download_count
      c_room: { type: 0, name: 'C Room', download_count: 50 },
      d_room: { type: 0, name: 'D Room', download_count: 5 },
    }
    for (const text of ['', ' ?! ']) {
      expect(ids(await hdriSearch(list, text))).toEqual(['c_room', 'a_room', 'd_room', 'b_room'])
    }
  })
})

// — asset list cache —

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const listResponse = () => new Response(JSON.stringify(LIST), { status: 200 })

/** A Poly Haven stand-in that counts /assets calls. `replies[i]` scripts the i-th
 *  list response (default: LIST). Like the real fetch, a request rejects with the
 *  signal's reason when its signal aborts. */
function listServer(replies: Array<() => Response | Promise<Response>> = []) {
  let listCalls = 0
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const u = String(input)
    let reply: Promise<Response>
    if (u.includes('/assets')) {
      const scripted = replies[listCalls++]
      reply = Promise.resolve().then(scripted ?? listResponse)
    } else {
      const m = u.match(/\/files\/([^/?]+)/)
      const files = m ? (FILES_TEX as Record<string, unknown>)[m[1]] : undefined
      reply = Promise.resolve(files ? new Response(JSON.stringify(files), { status: 200 }) : new Response('null', { status: 404 }))
    }
    const signal = init?.signal
    if (!signal) return reply
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      reply.then(resolve, reject)
    })
  }) as typeof fetch
  return {
    ctx: (signal?: AbortSignal): ProviderContext => ({ fetch: fetchImpl, ...(signal ? { signal } : {}) }),
    listCalls: () => listCalls,
  }
}
const q = (text: string) => ({ text, modalities: ['image' as const] })

describe('polyhaven asset list cache', () => {
  afterEach(() => { vi.useRealTimers() })

  it('downloads the list once for two searches on the same provider instance', async () => {
    const server = listServer()
    const p = polyhaven()
    expect(ids(await p.search(q('forest rock'), server.ctx()))).toEqual(['mossy_forest_rock', 'forest_floor'])
    expect(ids(await p.search(q('asphalt'), server.ctx()))).toEqual(['aerial_asphalt_01'])
    expect(server.listCalls()).toBe(1)
    // the cache belongs to the instance: another instance downloads its own list
    await polyhaven().search(q('asphalt'), server.ctx())
    expect(server.listCalls()).toBe(2)
  })

  it('refetches the list once the default one-hour TTL has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-10-26T00:00:00Z').getTime()
    vi.setSystemTime(t0)
    const server = listServer()
    const p = polyhaven()
    await p.search(q('forest'), server.ctx())
    vi.setSystemTime(t0 + 3_600_000 - 1)
    await p.search(q('forest'), server.ctx())
    expect(server.listCalls()).toBe(1)
    vi.setSystemTime(t0 + 3_600_000)
    await p.search(q('forest'), server.ctx())
    expect(server.listCalls()).toBe(2)
    await p.search(q('forest'), server.ctx()) // the fresh download is cached in turn
    expect(server.listCalls()).toBe(2)
  })

  it('honours a custom listTtlMs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const server = listServer()
    const p = polyhaven({ listTtlMs: 5_000 })
    await p.search(q('forest'), server.ctx())
    vi.setSystemTime(4_999)
    await p.search(q('forest'), server.ctx())
    expect(server.listCalls()).toBe(1)
    vi.setSystemTime(5_000)
    await p.search(q('forest'), server.ctx())
    expect(server.listCalls()).toBe(2)
  })

  it('does not cache a failed download: a network error or a non-OK status is retried by the next search', async () => {
    const server = listServer([
      () => { throw new TypeError('fetch failed') },
      () => new Response('busy', { status: 503 }),
    ])
    const p = polyhaven()
    await expect(p.search(q('forest'), server.ctx())).rejects.toThrow('fetch failed')
    await expect(p.search(q('forest'), server.ctx())).rejects.toThrow('polyhaven list failed: 503')
    expect(ids(await p.search(q('forest'), server.ctx()))).toEqual(['forest_floor', 'mossy_forest_rock'])
    await p.search(q('rock'), server.ctx()) // the successful download is the one cached
    expect(server.listCalls()).toBe(3)
  })

  it('fetches the list on every search with listTtlMs: 0', async () => {
    const server = listServer()
    const p = polyhaven({ listTtlMs: 0 })
    await p.search(q('forest'), server.ctx())
    await p.search(q('forest'), server.ctx())
    expect(server.listCalls()).toBe(2)
  })

  it('shares one in-flight download between concurrent searches', async () => {
    const gate = deferred<Response>()
    const server = listServer([() => gate.promise])
    const p = polyhaven()
    const searches = Promise.all([p.search(q('forest'), server.ctx()), p.search(q('asphalt'), server.ctx())])
    gate.resolve(listResponse())
    const [forest, asphalt] = await searches
    expect(ids(forest)).toEqual(['forest_floor', 'mossy_forest_rock'])
    expect(ids(asphalt)).toEqual(['aerial_asphalt_01'])
    expect(server.listCalls()).toBe(1)
  })

  it("rejects an aborted search at once without failing the shared download for anyone else", async () => {
    const gate = deferred<Response>()
    const server = listServer([() => gate.promise])
    const p = polyhaven()
    const ctrl = new AbortController()
    const aborted = p.search(q('forest'), server.ctx(ctrl.signal))
    const other = p.search(q('asphalt'), server.ctx())
    ctrl.abort(new Error('caller gave up'))
    await expect(aborted).rejects.toThrow('caller gave up') // while the list is still downloading
    gate.resolve(listResponse())
    expect(ids(await other)).toEqual(['aerial_asphalt_01'])
    // the download the aborted search started is the one later searches reuse
    expect(ids(await p.search(q('rock'), server.ctx()))).toEqual(['mossy_forest_rock'])
    expect(server.listCalls()).toBe(1)
  })
})
