# @refkit/provider-artic

Search the **Art Institute of Chicago** open-access collection as license-tagged image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Art Institute of Chicago ([artic.edu](https://www.artic.edu))
- **Auth:** keyless
- **Modality:** image
- **License:** CC0 (public-domain open access)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { artic } from '@refkit/provider-artic'

const refkit = createRefkit({ providers: [artic()] })
const refs = await refkit.search({ query: 'lion', modalities: ['image'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
