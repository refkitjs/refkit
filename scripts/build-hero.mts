// Build docs/hero.png from a LIVE refkit.search('lion', { rerank: lexicalReranker() }):
// query the four keyless providers, rerank, take the top result per source, bake
// each thumbnail in as base64, and rasterise to PNG (no browser). GitHub strips
// <image> from inline SVGs and Twitter needs a raster, so the PNG is the artifact
// the README/social posts use. Run on a machine with normal network egress:
//
//   pnpm install
//   npx tsx scripts/build-hero.mts
//
// Re-running re-queries live, so the hero reflects what the library actually returns.
import { writeFileSync } from 'node:fs'
import { createRefkit, lexicalReranker, type Reference, type RightsRecord } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { wikimediaCommons } from '@refkit/provider-wikimedia-commons'
import { met } from '@refkit/provider-met'
import { artic } from '@refkit/provider-artic'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

const SOURCE_LABEL: Record<string, string> = {
  'wikimedia-commons': 'via wikimedia commons',
  met: 'via the met',
  artic: 'via art institute of chicago',
  openverse: 'via openverse',
}

// Verdict → badge text + card palette. allowed (CC0/PD) reads green; attribution-
// required (CC-BY*) reads teal; anything stricter gets a neutral amber.
function verdictStyle(decision: string) {
  if (decision.startsWith('allowed-with-attribution'))
    return { verdict: '+ attribution', tint: '#ccfbf1', licColor: '#134e4a', vColor: '#115e59' }
  if (decision.startsWith('allowed'))
    return { verdict: 'allowed', tint: '#dcfce7', licColor: '#14532d', vColor: '#166534' }
  return { verdict: decision.replace(/-/g, ' '), tint: '#fef3c7', licColor: '#78350f', vColor: '#92400e' }
}

function licLabel(rights: RightsRecord): string {
  const fam = rights.license
  if (fam === 'CC0-1.0') return 'CC0'
  if (fam === 'PD') return 'Public Domain'
  if (fam.startsWith('CC-') && rights.licenseVersion) return `${fam} ${rights.licenseVersion}`
  return fam
}

// Providers hand back small preview thumbs; pull a larger rendition per source so the
// 3× hero stays crisp (artic defaults to 200px, the met to web-large/500px).
function upscale(url: string, providerId: string): string {
  if (providerId === 'artic') return url.replace(/\/full\/\d+,\//, '/full/1200,/')
  if (providerId === 'met') return url.replace('/web-large/', '/original/')
  return url
}

function splitTitle(title: string): string[] {
  const max = 24
  const t = title.trim()
  if (t.length <= max) return [t]
  const cut = t.lastIndexOf(' ', max)
  const head = t.slice(0, cut > 8 ? cut : max)
  let tail = t.slice((cut > 8 ? cut : max) + (cut > 8 ? 1 : 0))
  if (tail.length > max) tail = tail.slice(0, max - 1).trimEnd() + '…'
  return [head, tail]
}

async function dataUri(url: string): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' })
      if (!r.ok) throw new Error(`${r.status} for ${url}`)
      const ct = r.headers.get('content-type') || 'image/jpeg'
      return `data:${ct};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

// ---- live search ----
const QUERY = 'lion'
const rk = createRefkit({ providers: [openverse(), wikimediaCommons(), met(), artic()] })
const results = await rk.search({
  query: QUERY,
  modalities: ['image'],
  rerank: lexicalReranker(),
  limit: 40,
  onProviderError: (e) => console.warn(`  [warn] ${e.providerId}: ${(e.error as Error)?.message ?? e.error}`),
})

// Top result per source, in rerank order — a clean one-card-per-source strip.
const bySource = new Map<string, Reference>()
for (const r of results) {
  const thumb = r.thumbnail?.url ?? r.preview?.url
  if (!thumb) continue
  if (!bySource.has(r.source.providerId)) bySource.set(r.source.providerId, r)
}
const picks = [...bySource.values()].slice(0, 4)
if (picks.length < 2) throw new Error(`only ${picks.length} source(s) returned usable results — aborting`)
console.log(`picked ${picks.length} sources: ${picks.map((r) => r.source.providerId).join(', ')}`)

// ---- bake thumbnails first; a source whose image won't fetch is dropped, not fatal ----
const baked: { r: Reference; href: string }[] = []
for (const r of picks) {
  const thumbUrl = upscale(r.thumbnail?.url ?? r.preview!.url, r.source.providerId)
  try {
    baked.push({ r, href: await dataUri(thumbUrl) })
  } catch (e) {
    console.warn(`  [warn] dropped ${r.source.providerId} thumbnail: ${(e as Error)?.message ?? e}`)
  }
}
if (baked.length < 2) throw new Error(`only ${baked.length} thumbnail(s) baked — aborting`)

// ---- build the SVG ----
const W = 198, GAP = 32, X0 = 16, CY = 70 // CY = card-top y; the search-box header sits above it
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
let defs = '', body = ''
for (let i = 0; i < baked.length; i++) {
  const { r, href } = baked[i]
  const x = X0 + i * (W + GAP)
  const lic = licLabel(r.rights)
  const decision = rk.evaluateUse(r, 'commercial-product').decision
  const { verdict, tint, licColor, vColor } = verdictStyle(decision)
  const src = SOURCE_LABEL[r.source.providerId] ?? `via ${r.source.providerId}`
  const title = splitTitle((r.title ?? '').replace(/^\d+[\s_.-]+/, '')) // drop filename-prefix numbers like "002 "
  defs += `<clipPath id="img${i}"><rect x="${x}" y="${CY}" width="${W}" height="120" rx="14"/></clipPath>`
  body += `
  <rect x="${x}" y="${CY}" width="${W}" height="200" rx="14" fill="#fff" stroke="#e2e8f0"/>
  <image x="${x}" y="${CY}" width="${W}" height="120" href="${href}" preserveAspectRatio="xMidYMid slice" clip-path="url(#img${i})"/>
  <text x="${x + 16}" y="${CY + 140}" font-size="11" fill="#94a3b8">${esc(src)}</text>
  ${title.map((t, j) => `<text x="${x + 16}" y="${CY + 162 + j * 18}" font-size="13" font-weight="500" fill="#0f172a">${esc(t)}</text>`).join('')}
  <text x="${x + 16}" y="${CY + 194}" font-size="13" font-weight="700" fill="${licColor}">${esc(lic)}</text>
  <rect x="${x + (lic.length > 4 ? 108 : 60)}" y="${CY + 182}" width="${verdict.length * 7 + 16}" height="20" rx="6" fill="${tint}"/>
  <text x="${x + (lic.length > 4 ? 116 : 68)}" y="${CY + 196}" font-size="11" font-weight="600" fill="${vColor}">${esc(verdict)}</text>`
}

const VBW = X0 * 2 + baked.length * W + (baked.length - 1) * GAP
// Header: a search-box mockup showing the actual query, so the strip reads as
// "one search → license-tagged references", not an unexplained row of photos.
const header = `
  <rect x="${X0}" y="16" width="300" height="38" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
  <circle cx="${X0 + 22}" cy="33" r="6" fill="none" stroke="#94a3b8" stroke-width="2"/>
  <line x1="${X0 + 26.5}" y1="37.5" x2="${X0 + 31}" y2="42" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
  <text x="${X0 + 40}" y="40" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" fill="#475569">refkit.search(<tspan fill="#0f172a" font-weight="700">"${esc(QUERY)}"</tspan>)</text>
  <text x="${X0 + 316}" y="40" font-size="13" fill="#94a3b8">→ reranked · every result license-tagged</text>`
const svg = `<svg viewBox="0 0 ${VBW} 286" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" role="img" aria-label="refkit.search('${esc(QUERY)}') across ${baked.length} sources, reranked — every result license-tagged">
<defs>${defs}</defs>${header}${body}
</svg>\n`

// ---- rasterise to PNG (pure Rust, no browser) ----
const { Resvg } = await import('@resvg/resvg-js')
const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: VBW * 3 }, // 3× the viewBox — sharp text + no image upscaling
  background: 'white',
  font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
})
  .render()
  .asPng()
writeFileSync(new URL('../docs/hero.png', import.meta.url), png)
console.log(`wrote docs/hero.png (${(png.length / 1024).toFixed(0)} KB, 2760px wide)`)
