# @refkit/provider-rijksmuseum

Search **Rijksmuseum** as license-tagged image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Rijksmuseum
- **Auth:** keyless
- **Modality:** image
- **License:** CC0 / PD

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { rijksmuseum } from '@refkit/provider-rijksmuseum'

const refkit = createRefkit({ providers: [rijksmuseum()] })
const refs = await refkit.search({ query: 'cat', modalities: ['image'] })
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
