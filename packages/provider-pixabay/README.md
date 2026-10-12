# @refkit/provider-pixabay

Search **Pixabay** stock photos and video as license-tagged references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Pixabay ([pixabay.com](https://pixabay.com))
- **Auth:** API key — `pixabay({ key: '…' })`
- **Modality:** image · video
- **License:** Pixabay license (free to use incl. commercial, no attribution legally required; not redistributable as-is)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { pixabay, pixabayVideo } from '@refkit/provider-pixabay'

const key = { key: process.env.PIXABAY_KEY! }
const refkit = createRefkit({ providers: [pixabay(key), pixabayVideo(key)] })
const images = await refkit.search({ query: 'forest', modalities: ['image'] })
const clips = await refkit.search({ query: 'forest', modalities: ['video'] })
// every result carries source + license + attribution + canonicalUrl
```

`pixabay()` serves the image leg (source id `pixabay`); add `pixabayVideo()` (same key) for video (source id `pixabay-video`).

A video result carries `video.durationSec` (seconds, when positive) and `kind` from Pixabay's `type` (`film` or `animation`). Its `preview` is the first usable rendition of large → medium → small → tiny (one with a non-empty URL and a non-zero size), with that rendition's `width` / `height`; `visual` is left unset, because it means the original's size, which the response does not give. A hit with no usable rendition is skipped.

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
