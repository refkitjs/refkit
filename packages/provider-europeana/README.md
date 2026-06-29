# @refkit/provider-europeana

Search **Europeana** as license-tagged image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Europeana
- **Auth:** API key
- **Modality:** image
- **License:** per-item CC / PD / rights-statement

> v1 returns images only (`type=IMAGE`); audio/video/text records are a planned follow-up. Media is hotlinked from third-party data providers — cache/rehost is not permitted (`rehostPolicy: 'hotlink-required'`).

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { europeana } from '@refkit/provider-europeana'

const refkit = createRefkit({ providers: [europeana(/* config */)] })
const refs = await refkit.search({ query: 'cat', modalities: ['image'] })
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
