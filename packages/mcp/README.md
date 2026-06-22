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

## Grey / web sources (you inject your own)

refkit ships only **clean, license-normalized** providers. Open-web image search (Google/Bing/Brave) returns arbitrary results with **no license** — so it doesn't belong in refkit's OSS surface. But the `ReferenceProvider` contract accepts any host-supplied provider, including a `license: 'unknown'` one. Wire your own:

```ts
import { defineProvider, referenceId, type Reference } from '@refkit/core'

// A grey/web-search provider: breadth, but every result is license-unknown →
// evaluateUse returns needs-review (never auto-allowed). The CALLER decides.
export const braveImages = (cfg: { token: string }) => defineProvider({
  id: 'brave',
  modalities: ['image'],
  queryFeatures: ['keyword'],
  async search(q, ctx): Promise<Reference[]> {
    const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(q.text)}`
    const res = await ctx.fetch(url, { headers: { 'X-Subscription-Token': cfg.token }, signal: ctx.signal })
    const json = await res.json()
    return json.results.map((r: any): Reference => ({
      id: referenceId('brave', r.url),
      modality: 'image',
      title: r.title,
      source: { providerId: 'brave', sourceUrl: r.url },
      canonicalUrl: r.url,
      rights: {
        license: 'unknown',          // open web → no license metadata → needs-review downstream
        rehostPolicy: 'thumbnail-only',
        raw: { sourceTerms: '', sourceUrl: r.url },
      },
      verifiedAt: new Date().toISOString(),
      thumbnail: { url: r.thumbnail?.src },
      relevance: 0,
      raw: r,
    }))
  },
})
```

Then add `braveImages({ token: process.env.BRAVE_TOKEN! })` to your `createRefkit({ providers })`. Its results will always be `needs-review` — use them for discovery / internal moodboards, and verify the source before any commercial or generation use.
