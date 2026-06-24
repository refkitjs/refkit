# @refkit/provider-openverse

Search **Openverse** (the CC / public-domain media aggregator) as license-normalized image and audio references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Openverse ([openverse.org](https://openverse.org))
- **Auth:** keyless
- **Modality:** image · audio
- **License:** per-item Creative Commons / public domain (CC version preserved in `rights.licenseVersion`)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { openverse, openverseAudio } from '@refkit/provider-openverse'

const refkit = createRefkit({ providers: [openverse(), openverseAudio()] })
const images = await refkit.search({ query: 'lion', modalities: ['image'] })
const audio = await refkit.search({ query: 'rain', modalities: ['audio'] })
// every result carries source + license + attribution + canonicalUrl
```

`openverse()` serves the image leg; add `openverseAudio()` for audio. Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
