# @refkit/core

The neutral brain of **refkit** — a dependency-light reference-retrieval toolkit for creative work. It defines the `Reference` contract, normalizes per-result licensing, runs a strict-deny use-gate, and fuses/dedups results across sources. **Zero network, zero providers, only depends on `zod`** — you add `@refkit/provider-*` satellites for the sources you want.

```bash
pnpm add @refkit/core @refkit/provider-openverse @refkit/provider-met
```

## Quickstart

```ts
import { createRefkit, lexicalReranker } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { met } from '@refkit/provider-met'

const refkit = createRefkit({
  providers: [openverse(), met()], // both keyless
  // fetch defaults to globalThis.fetch — inject your own to add caching/retries
})

// Fan out, merge (Reciprocal Rank Fusion) + dedup; every result carries rights.
const refs = await refkit.search({
  query: 'cyberpunk alley at night',
  modalities: ['image'],
  rerank: lexicalReranker(), // optional, zero-dep query-aware reorder
  limit: 12,
})

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

## Search controls

Portable controls are expressed once and applied only to providers that declare support:

```ts
await refkit.search({
  query: 'minimal workspace',
  modalities: ['image'],
  controls: {
    orientation: 'landscape',
    color: 'white',
    language: 'en-US',
  },
})
```

Provider-specific escape hatches go under `providerOptions`, keyed by provider id. Core routes only the matching entry; providers whitelist the upstream parameters they translate:

```ts
await refkit.search({
  query: 'mountain trail',
  modalities: ['image'],
  controls: { orientation: 'landscape', safety: 'strict' },
  providerOptions: {
    flickr: { sort: 'relevance', tags: ['mountain', 'trail'], tagMode: 'all' },
    unsplash: { collections: ['abc', 'def'] },
  },
})
```

Currently supported unified controls:

| Provider id | Unified controls |
|---|---|
| `unsplash` | `orientation`, `color`, `language`, `sort`, `safety` |
| `pexels` | `orientation`, `color`, `language`, `media.size`, `page` |
| `pexels-video` | `orientation`, `language`, `media.size`, `page` |
| `pixabay` | `orientation`, `color`, `language`, `sort`, `safety`, `media.kind`, `media.minWidth`, `media.minHeight` |
| `pixabay-video` | `language`, `sort`, `safety`, `media.kind`, `media.minWidth`, `media.minHeight` |
| `flickr` | `sort`, `safety`, `license.commercial`, `license.modification`, `license.allowUnknown`, `creator.id` |
| `brave` | `safety` |
| `openverse` | `license.commercial`, `license.modification`, `license.allowUnknown` |
| `openverse-audio` | `license.commercial`, `license.modification`, `license.allowUnknown` |
| `gutendex` | `language`, `text.copyright`, `page` |
| `poetrydb`, `wikimedia-commons`, `met`, `artic`, `smithsonian` | no unified controls in this release |

Use `searchWithMeta` when a host UI or agent needs the search explanation layer:

```ts
const { references, meta } = await refkit.searchWithMeta({
  query: 'minimal workspace',
  modalities: ['image'],
  controls: { orientation: 'landscape', color: 'white' },
  gateFor: 'commercial-product',
})

meta.controls?.appliedByProvider
meta.controls?.ignoredByProvider
meta.providers // provider status: fulfilled / failed / skipped
meta.gate      // before/after/dropped counts when gateFor is used
meta.warnings  // partial-result and gate/drop notes
```

## Ranking & rerank

Results are fused across sources with **Reciprocal Rank Fusion** (cross-source-orderable, not query-aware). Pass an optional `rerank`:

- `lexicalReranker(opts?)` — batteries-included, no model, no network. Scores each result by query↔(title+excerpt) term coverage, resolution quality, and license permissiveness, then spreads sources with MMR-lite. Weights are tunable: `lexicalReranker({ qualityWeight: 0.3, licenseWeight: 0.2, sourceDiversity: 0.15 })`.
- **Bring your own** — the `Reranker` hook receives `{ query, refs, signal }` and returns reordered refs, so you can wire a CLIP/embedding/LLM reranker to your own API. `core` ships no model; this is the only seam.

Rerank is opt-in and runs post-merge, before the `gateFor` license filter and the limit.

Ranking is only as good as the candidate pool: `search` overfetches `limit × poolFactor` per provider (default 4×, capped per source) and narrows to `limit` after merge/rerank/gate — so dedup and ranking see a wide pool, not a source-truncated slice. Lower `poolFactor` when you query many providers.

## Dedupe hooks

Core dedupes exact canonical URLs by default and can dedupe equal-length perceptual hashes when `merge.hashThreshold` is set. Hosts that compute their own fingerprints or embeddings can add a sync duplicate predicate:

```ts
const refkit = createRefkit({
  providers,
  merge: {
    isDuplicate: (candidate, existing) =>
      (candidate.raw as { fingerprint?: string }).fingerprint ===
      (existing.raw as { fingerprint?: string }).fingerprint,
  },
})
```

The hook compares `Reference` objects only. Core still never fetches, decodes, or stores media.

## Invariants (enforced by `src/__tests__/no-network.test.ts`)

- **Zero network** — no `fetch` call, no hard-coded endpoint in this package. Hosts inject `ProviderContext.fetch`.
- **Substrate-agnostic** — no import of any host or orchestration framework.
- **Only `zod`** as a non-relative dependency.
- **No re-hosting** — keep `canonicalUrl` + thumbnails only; never store originals.
- **strict-deny** — when rights can't be determined, deny / `needs-review` (never fail-open). Unknown, NonCommercial, NoDerivatives, and "no known copyright restrictions" never map to a usable license.

## Not legal advice

`evaluateUse` returns a **conservative heuristic** based on source-declared license/ToS facts. It is **not legal advice** and does not determine legal rights. Every verdict carries a `disclaimer` and a `confidence`. For real legal posture — especially feeding references into AI generation — consult counsel.
