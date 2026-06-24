# @refkit/provider-flickr

Search **Flickr** photos as license-normalized image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Flickr ([flickr.com](https://www.flickr.com))
- **Auth:** API key — `flickr({ apiKey: '…' })`
- **Modality:** image
- **License:** per-item Creative Commons / public domain (each photo's declared license is normalized; "no known copyright restrictions" maps to `unknown`, not public domain)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { flickr } from '@refkit/provider-flickr'

const refkit = createRefkit({ providers: [flickr({ apiKey: process.env.FLICKR_KEY! })] })
const refs = await refkit.search({ query: 'lion', modalities: ['image'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
