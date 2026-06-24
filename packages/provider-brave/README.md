# @refkit/provider-brave

Open-web image **discovery** via the Brave Search API — breadth, with honest license gating — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Brave Search image API ([brave.com/search/api](https://brave.com/search/api/))
- **Auth:** API key — `brave({ token: '…' })`
- **Modality:** image (open-web)
- **License:** `unknown` → `needs-review` (a discovery source; results are never auto-allowed)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { brave } from '@refkit/provider-brave'

const refkit = createRefkit({ providers: [brave({ token: process.env.BRAVE_TOKEN! })] })
const refs = await refkit.search({ query: 'cyberpunk alley', modalities: ['image'] })
// every result carries source + license + attribution + canonicalUrl
```

Use discovery results for inspiration / internal moodboards. Because their license is `unknown`, `refkit.evaluateUse(ref, 'commercial-product')` returns `needs-review` — verify the source's terms before any commercial or generation use, or pass `gateFor: 'commercial-product'` to drop them. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
