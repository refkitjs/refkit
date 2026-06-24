# @refkit/provider-gutendex

Search **Project Gutenberg** (public-domain books, via Gutendex) as text references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Project Gutenberg via Gutendex ([gutendex.com](https://gutendex.com))
- **Auth:** keyless
- **Modality:** text
- **License:** per-item public domain (each work's copyright status is normalized; anything not clearly PD maps to `unknown`)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { gutendex } from '@refkit/provider-gutendex'

const refkit = createRefkit({ providers: [gutendex()] })
const refs = await refkit.search({ query: 'whale', modalities: ['text'] })
// every result carries source + license + attribution + canonicalUrl
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
