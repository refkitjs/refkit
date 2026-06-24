# @refkit/provider-smithsonian

Search **Smithsonian Open Access** as license-tagged image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Smithsonian Open Access ([si.edu/openaccess](https://www.si.edu/openaccess))
- **Auth:** API key — `smithsonian({ apiKey: '…' })` (a free api.data.gov key)
- **Modality:** image
- **License:** CC0 (open-access items only)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { smithsonian } from '@refkit/provider-smithsonian'

const refkit = createRefkit({ providers: [smithsonian({ apiKey: process.env.SI_KEY! })] })
const refs = await refkit.search({ query: 'lion', modalities: ['image'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
