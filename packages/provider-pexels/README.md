# @refkit/provider-pexels

Search **Pexels** stock photos and video as license-tagged references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Pexels ([pexels.com](https://www.pexels.com))
- **Auth:** API key — `pexels({ apiKey: '…' })`
- **Modality:** image · video
- **License:** Pexels license (free to use incl. commercial, no attribution legally required; not redistributable as-is)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { pexels, pexelsVideo } from '@refkit/provider-pexels'

const key = { apiKey: process.env.PEXELS_KEY! }
const refkit = createRefkit({ providers: [pexels(key), pexelsVideo(key)] })
const images = await refkit.search({ query: 'forest', modalities: ['image'] })
const clips = await refkit.search({ query: 'forest', modalities: ['video'] })
// every result carries source + license + attribution + canonicalUrl
```

`pexels()` serves the image leg; add `pexelsVideo()` (same key) for video. Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
