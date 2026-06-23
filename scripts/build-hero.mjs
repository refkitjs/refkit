// Build docs/hero.svg with the four real thumbnails baked in as base64 (so it
// renders anywhere, no remote/cross-origin deps). Run on a machine with normal
// network egress (a CI sandbox often can't reach these image hosts):
//
//   node scripts/build-hero.mjs
//
// Data is a real refkit.search('lion') across four sources.
import { writeFileSync } from 'node:fs'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

const cards = [
  { src: 'via the met', title: ['Handle Depicting a Lion', 'Subduing a Nubian'], lic: 'CC0', verdict: 'allowed', tint: '#dcfce7', licColor: '#14532d', vColor: '#166534',
    url: 'https://images.metmuseum.org/CRDImages/eg/web-large/DT226224.jpg' },
  { src: 'via art institute of chicago', title: ['Lion Hunt', 'Eugène Delacroix'], lic: 'CC0', verdict: 'allowed', tint: '#dcfce7', licColor: '#14532d', vColor: '#166534',
    url: 'https://www.artic.edu/iiif/2/1299b0e5-6a3d-8039-087b-35bf03caea1a/full/600,/0/default.jpg' },
  { src: 'via wikimedia commons', title: ['Lion (Panthera leo)', 'male 6y'], lic: 'CC-BY-SA 4.0', verdict: '+ attribution', tint: '#ccfbf1', licColor: '#134e4a', vColor: '#115e59', credit: '© Charles J. Sharp',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Lion_%28Panthera_leo%29_male_6y.jpg/600px-Lion_%28Panthera_leo%29_male_6y.jpg' },
  { src: 'via openverse', title: ['Lion'], lic: 'CC-BY 2.0', verdict: '+ attribution', tint: '#ccfbf1', licColor: '#134e4a', vColor: '#115e59', credit: '© Noveltyy',
    url: 'https://api.openverse.org/v1/images/bf0009c1-883d-4823-9bc6-72e62ab36741/thumb/' },
]

async function dataUri(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, redirect: 'follow' })
  if (!r.ok) throw new Error(`${r.status} for ${url}`)
  const ct = r.headers.get('content-type') || 'image/jpeg'
  const b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
  return `data:${ct};base64,${b64}`
}

const W = 198, GAP = 32, X0 = 16, esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
let defs = '', body = ''
for (let i = 0; i < cards.length; i++) {
  const c = cards[i], x = X0 + i * (W + GAP)
  const href = await dataUri(c.url)
  defs += `<clipPath id="img${i}"><rect x="${x}" y="10" width="${W}" height="120" rx="14"/></clipPath>`
  body += `
  <rect x="${x}" y="10" width="${W}" height="200" rx="14" fill="#fff" stroke="#e2e8f0"/>
  <image x="${x}" y="10" width="${W}" height="120" href="${href}" preserveAspectRatio="xMidYMid slice" clip-path="url(#img${i})"/>
  <text x="${x + 16}" y="150" font-size="11" fill="#94a3b8">${esc(c.src)}</text>
  ${c.title.map((t, j) => `<text x="${x + 16}" y="${172 + j * 18}" font-size="13" font-weight="500" fill="#0f172a">${esc(t)}</text>`).join('')}
  <text x="${x + 16}" y="204" font-size="13" font-weight="700" fill="${c.licColor}">${c.lic}</text>
  <rect x="${x + (c.lic.length > 4 ? 108 : 60)}" y="192" width="${c.verdict.length * 7 + 16}" height="20" rx="6" fill="${c.tint}"/>
  <text x="${x + (c.lic.length > 4 ? 116 : 68)}" y="206" font-size="11" font-weight="600" fill="${c.vColor}">${c.verdict}</text>`
}

const svg = `<svg viewBox="0 0 920 226" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" role="img" aria-label="One refkit.search('lion') across four sources, each result license-tagged">
<defs>${defs}</defs>${body}
</svg>\n`

writeFileSync(new URL('../docs/hero.svg', import.meta.url), svg)
console.log('wrote docs/hero.svg with 4 embedded thumbnails')
