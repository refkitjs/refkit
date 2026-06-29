# @refkit/provider-freesound

Search **Freesound** as license-tagged audio references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Freesound
- **Auth:** API key
- **Modality:** audio
- **License:** per-item CC / CC0

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { freesound } from '@refkit/provider-freesound'

const refkit = createRefkit({ providers: [freesound(/* config */)] })
const refs = await refkit.search({ query: 'cat', modalities: ['audio'] })
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
