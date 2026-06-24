# @refkit/provider-poetrydb

Search **PoetryDB** (public-domain poetry) as text references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** PoetryDB ([poetrydb.org](https://poetrydb.org))
- **Auth:** keyless
- **Modality:** text
- **License:** public domain

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { poetrydb } from '@refkit/provider-poetrydb'

const refkit = createRefkit({ providers: [poetrydb()] })
const refs = await refkit.search({ query: 'the sea', modalities: ['text'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
