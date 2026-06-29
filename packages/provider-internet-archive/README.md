# @refkit/provider-internet-archive

Search **Internet Archive** as license-tagged video · text references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Internet Archive
- **Auth:** keyless
- **Modality:** video · text
- **License:** per-item CC (dirty) → unknown fallback

> **v1 scope:** only `mediatype: movies` (→ `video`) and `mediatype: texts` (→ `text`) are mapped. All other mediatypes (`audio`, `image`, `collection`, `software`, `web`, `data`, `etree`) are filtered out and are a documented follow-up.

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { internetArchive } from '@refkit/provider-internet-archive'

const refkit = createRefkit({ providers: [internetArchive(/* config */)] })
const refs = await refkit.search({ query: 'cat', modalities: ['video'] })
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
