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

## Hosting note (production / server-side use)

The default host, `gutendex.com`, is the upstream maintainer's **test instance** — the [Gutendex docs](https://github.com/garethbjohnson/gutendex) say "You should run your own server, but you can test queries at gutendex.com", and its Cloudflare front blocks datacenter IPs (e.g. CI runners, cloud servers) regardless of headers. Desktop/local use works out of the box. For production or server-side traffic, [self-host Gutendex](https://github.com/garethbjohnson/gutendex/wiki/Installation-Guide) and point the provider at your instance:

```ts
gutendex({ baseUrl: 'https://gutendex.your-domain.example' })
```

When the public instance blocks a request, the search degrades gracefully: this source is reported as `failed` in `meta.providers` and results from other providers still return.
