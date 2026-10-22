// Build plugins/refkit/assets/icon.png from icon.svg next to it. The PNG is what
// Anthropic's plugin directory and the Codex app show; the SVG is the source and
// the Codex composer icon. Re-run after editing the SVG:
//
//   npx tsx scripts/build-plugin-icon.mts
import { readFileSync, writeFileSync } from 'node:fs'

const assets = new URL('../plugins/refkit/assets/', import.meta.url)
const svg = readFileSync(new URL('icon.svg', assets), 'utf8')

// ---- rasterise to PNG (pure Rust, no browser) ----
const { Resvg } = await import('@resvg/resvg-js')
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng()
writeFileSync(new URL('icon.png', assets), png)
console.log(`wrote plugins/refkit/assets/icon.png (${(png.length / 1024).toFixed(0)} KB, 512px)`)
