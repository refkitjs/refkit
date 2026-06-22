# @refkit/mcp

An MCP server that exposes refkit's **license-normalized reference search** as an agent tool (`search_references`).

## Run it

The host owns wiring — which providers, which BYOK keys — and passes a configured `RefkitClient`:

```ts
import { serveStdio } from '@refkit/mcp'
import { createRefkit } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { unsplash } from '@refkit/provider-unsplash'
import { gutendex } from '@refkit/provider-gutendex'

await serveStdio(createRefkit({
  providers: [
    openverse(),                                   // keyless
    unsplash({ accessKey: process.env.UNSPLASH_KEY! }),
    gutendex(),
  ],
  // fetch defaults to globalThis.fetch
}))
```

`search_references` input: `{ query, modalities?, limit?, gateFor? }`. Output: `{ references: [{ id, title?, modality, provider, canonicalUrl, license, thumbnail?, excerpt? }] }`. Pass `gateFor: 'commercial-product'` (etc.) to return only results the license permits for that use.

> Results are references with a license id + source link — **not rights clearance, not legal advice**. `unknown`/`needs-review` results require the caller to verify the source's terms.

## Discovery (web) source

refkit's clean providers give license-normalized results. For open-web **breadth** (e.g. "cyberpunk alley"), add the Brave discovery provider — its results carry `license: 'unknown'`, so refkit's use-gate returns `needs-review` for every one (never auto-allowed):

```ts
import { brave } from '@refkit/provider-brave'

createRefkit({
  providers: [
    openverse(),                                  // clean (license-normalized)
    brave({ token: process.env.BRAVE_TOKEN! }),   // discovery (license: unknown → needs-review)
  ],
})
```

Use discovery results for inspiration / internal moodboards; for commercial or generation use they're `needs-review` — verify the source first. Pass `gateFor: 'commercial-product'` to `search_references` to drop them automatically. Other web engines (Google CSE, Bing) are host-injectable via the same `ReferenceProvider` contract.
