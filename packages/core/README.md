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

## Ranking & rerank

Results are fused across sources with **Reciprocal Rank Fusion** (cross-source-orderable, not query-aware). Pass an optional `rerank`:

- `lexicalReranker(opts?)` — batteries-included, no model, no network. Scores each result by query↔(title+excerpt) term coverage, resolution quality, and license permissiveness, then spreads sources with MMR-lite. Weights are tunable: `lexicalReranker({ qualityWeight: 0.3, licenseWeight: 0.2, sourceDiversity: 0.15 })`.
- **Bring your own** — the `Reranker` hook receives `{ query, refs, signal }` and returns reordered refs, so you can wire a CLIP/embedding/LLM reranker to your own API. `core` ships no model; this is the only seam.

Rerank is opt-in and runs post-merge, before the `gateFor` license filter and the limit.

## Invariants (enforced by `src/__tests__/no-network.test.ts`)

- **Zero network** — no `fetch` call, no hard-coded endpoint in this package. Hosts inject `ProviderContext.fetch`.
- **Substrate-agnostic** — no import of any host or orchestration framework.
- **Only `zod`** as a non-relative dependency.
- **No re-hosting** — keep `canonicalUrl` + thumbnails only; never store originals.
- **strict-deny** — when rights can't be determined, deny / `needs-review` (never fail-open). Unknown, NonCommercial, NoDerivatives, and "no known copyright restrictions" never map to a usable license.

## Not legal advice

`evaluateUse` returns a **conservative heuristic** based on source-declared license/ToS facts. It is **not legal advice** and does not determine legal rights. Every verdict carries a `disclaimer` and a `confidence`. For real legal posture — especially feeding references into AI generation — consult counsel.
