# refkit

Neutral, dependency-light **reference-retrieval toolkit for creative work** — search images / video / audio / text as creative references, with **per-result license normalization** so every result carries `source + license + attribution + canonicalUrl`.

![One refkit.search("lion"), reranked, across multiple sources — every result arrives license-tagged](docs/hero.png)

> Apache-2.0 · `v0.1.0` — first public release. The API surface (`createRefkit`) is stable; provider coverage is growing.

## Why

Multimedia creators constantly "search X images as reference" / "find a Y passage for structure". No existing library combines all five of: **multi-source aggregation × per-result license normalization × agent-callable × embeddable BYOK SDK × visual AND text**. refkit fills that gap.

The defensible core is **not** multi-source fan-out (a commodity) — it is the **license normalization + strict-deny use-gate + dual-modal contract**, plus flowing results into a generation pipeline as provenance-carrying assets.

## Install

```bash
pnpm add @refkit/core @refkit/provider-openverse @refkit/provider-met
```

`@refkit/core` is the brain; each source is a thin `@refkit/provider-*` satellite you add as needed.

## Quickstart

```ts
import { createRefkit } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { met } from '@refkit/provider-met'
import { unsplash } from '@refkit/provider-unsplash'

const refkit = createRefkit({
  providers: [
    openverse(),  // keyless
    met(),        // keyless
    unsplash({ accessKey: process.env.UNSPLASH_KEY! }), // BYOK
  ],
  // fetch defaults to globalThis.fetch — inject your own to add caching/retries
})

// Fan out, merge (Reciprocal Rank Fusion) + dedup; every result carries rights.
const refs = await refkit.search({ query: 'cyberpunk alley at night', modalities: ['image'], limit: 12 })

for (const r of refs) {
  // intents: 'internal-moodboard' | 'commercial-product' | 'ai-generation-input' | 'redistribution'
  const verdict = refkit.evaluateUse(r, 'commercial-product')
  // 'allowed' | 'allowed-with-attribution' | 'denied' | 'needs-review'
  if (verdict.decision === 'allowed-with-attribution') {
    console.log(r.canonicalUrl, refkit.buildAttribution(r).text)
  }
}

// Or gate at search time — only return commercially-usable results:
const safe = await refkit.search({ query: 'forest', modalities: ['image'], gateFor: 'commercial-product' })
```

## Providers

| Package | Source | Modality | Auth | License |
|---|---|---|---|---|
| `@refkit/provider-openverse` | Openverse (CC aggregator) | image · audio | keyless | per-item CC / PD |
| `@refkit/provider-wikimedia-commons` | Wikimedia Commons | image | keyless | per-item CC / PD |
| `@refkit/provider-met` | The Metropolitan Museum of Art | image | keyless | CC0 |
| `@refkit/provider-artic` | Art Institute of Chicago | image | keyless | CC0 |
| `@refkit/provider-smithsonian` | Smithsonian Open Access | image | API key | CC0 |
| `@refkit/provider-flickr` | Flickr | image | API key | per-item CC / PD |
| `@refkit/provider-unsplash` | Unsplash | image | API key | Unsplash |
| `@refkit/provider-pexels` | Pexels | image · video | API key | Pexels |
| `@refkit/provider-pixabay` | Pixabay | image · video | API key | Pixabay |
| `@refkit/provider-gutendex` | Project Gutenberg | text | keyless | per-item PD |
| `@refkit/provider-poetrydb` | PoetryDB | text | keyless | PD |
| `@refkit/provider-brave` | Brave web search (discovery) | image (web) | API key | unknown → needs-review |

Audio/video are extra factories on existing packages: `openverseAudio()`, `pexelsVideo()`, `pixabayVideo()`. Modality routing is automatic — an `['audio']` search only hits audio-capable providers.

## Architecture

```
@refkit/core           neutral brain — zero network, zero providers, only zod
  Reference contract · RightsModel + license facts · strict-deny use-gate ·
  RRF cross-source merge/dedup · ReferenceProvider interfaces · dual-modal envelope

@refkit/provider-*      thin satellites — one source each; the commodity layer

@refkit/mcp             agent face — exposes search_references over MCP

(host binding)          maps Reference → the host's asset/generation model;
  injects keys (BYOK), fetch, cache. Lives in the consuming app, not here.
```

**Dependency direction is one-way:** `provider-*` → `core`; hosts → `core`. `core` depends on nothing but `zod`, and never on any host or orchestration framework.

## Core invariants (enforced by tests in `@refkit/core`)

- **Zero network in `core`** — no `fetch` call, no hard-coded endpoint. Hosts inject `ProviderContext.fetch`.
- **No re-hosting** — keep `canonicalUrl` + thumbnails only; never store originals.
- **strict-deny** — when rights can't be determined, deny / needs-review (never fail-open). Unknown, NonCommercial, NoDerivatives and "no known copyright restrictions" never map to a usable license.

## Agent / MCP

`@refkit/mcp` exposes `search_references` over the [Model Context Protocol](https://modelcontextprotocol.io), so any MCP-capable agent can search license-normalized references with zero glue code.

## Not legal advice

`evaluateUse` returns a **conservative heuristic** based on source-declared license/ToS facts. It is **not legal advice** and does not determine legal rights. Every verdict carries a `disclaimer` and a `confidence`. For real legal posture (especially feeding references into AI generation), consult counsel.

## Develop

```bash
pnpm install
pnpm typecheck   # all packages
pnpm test:run    # all packages
pnpm build       # tsup → dist for every package
```

Releases are automated with [changesets](https://github.com/changesets/changesets): run `pnpm changeset` to record a change; merging the CI-generated "Version Packages" PR publishes to npm.
