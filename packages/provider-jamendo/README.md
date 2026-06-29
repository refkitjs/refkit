# @refkit/provider-jamendo

Search **Jamendo** as license-tagged audio references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Jamendo
- **Auth:** API key
- **Modality:** audio
- **License:** per-item CC

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { jamendo } from '@refkit/provider-jamendo'

const refkit = createRefkit({ providers: [jamendo(/* config */)] })
const refs = await refkit.search({ query: 'cat', modalities: ['audio'] })
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
