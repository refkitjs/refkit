# @refkit/provider-unsplash

Search **Unsplash** photos as license-tagged image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Unsplash ([unsplash.com](https://unsplash.com))
- **Auth:** API key — `unsplash({ accessKey: '…' })`
- **Modality:** image
- **License:** Unsplash license (free to use incl. commercial, no attribution legally required; not redistributable as-is)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { unsplash } from '@refkit/provider-unsplash'

const refkit = createRefkit({ providers: [unsplash({ accessKey: process.env.UNSPLASH_KEY! })] })
const refs = await refkit.search({ query: 'forest', modalities: ['image'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
