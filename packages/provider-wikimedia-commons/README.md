# @refkit/provider-wikimedia-commons

Search **Wikimedia Commons** as license-normalized image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Wikimedia Commons ([commons.wikimedia.org](https://commons.wikimedia.org))
- **Auth:** keyless
- **Modality:** image
- **License:** per-item Creative Commons / public domain (CC version preserved in `rights.licenseVersion`; attribution + share-alike surfaced where required)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { wikimediaCommons } from '@refkit/provider-wikimedia-commons'

const refkit = createRefkit({ providers: [wikimediaCommons()] })
const refs = await refkit.search({ query: 'lion', modalities: ['image'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
