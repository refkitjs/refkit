# @refkit/provider-met

Search **The Metropolitan Museum of Art** open-access collection as license-tagged image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** The Metropolitan Museum of Art ([metmuseum.org](https://www.metmuseum.org))
- **Auth:** keyless
- **Modality:** image
- **License:** CC0 (open-access works only)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { met } from '@refkit/provider-met'

const refkit = createRefkit({ providers: [met()] })
const refs = await refkit.search({ query: 'lion', modalities: ['image'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
