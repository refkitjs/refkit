# @refkit/core

The neutral brain of **refkit** — a dependency-light reference-retrieval toolkit for creative work. It defines the `Reference` contract, normalizes per-result licensing, runs a strict-deny use-gate, and fuses/dedups results across sources. **Zero network, zero providers, only depends on `zod`** — you add `@refkit/provider-*` satellites for the sources you want.

```bash
pnpm add @refkit/core @refkit/provider-openverse @refkit/provider-met
```

## Quickstart

```ts
import { createRefkit } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { met } from '@refkit/provider-met'

const refkit = createRefkit({
  providers: [openverse(), met()], // both keyless
  // fetch defaults to globalThis.fetch — inject your own to add caching/retries
})

// Fan out, merge (Reciprocal Rank Fusion, weighted by how well each source
// answered) + dedup, then re-rank for the query — all on by default. Every
// result carries rights.
const refs = await refkit.search({
  query: 'cyberpunk alley at night',
  modalities: ['image'],
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

Provider-specific escape hatches go under `providerOptions`, keyed by provider id. Core routes only the matching entry; providers own typed whitelists for the practical official search parameters they translate:

```ts
await refkit.search({
  query: 'mountain trail',
  modalities: ['image'],
  controls: { orientation: 'landscape', safety: 'strict' },
  providerOptions: {
    unsplash: { collections: ['abc', 'def'], page: 2 },
    flickr: { sort: 'relevance', tags: ['mountain', 'trail'], tagMode: 'all' },
    openverse: { source: ['flickr'], category: 'photograph', aspectRatio: 'wide' },
    smithsonian: { sort: 'newest', rows: 25 },
  },
})
```

`providerOptions` is not a raw upstream passthrough. Each provider package exports its own `*SearchOptions` interface and keeps response-format/debug/auth-only parameters out when they would conflict with normalized references or provider credentials.

Currently supported unified controls:

| Provider id | Unified controls |
|---|---|
| `unsplash` | `orientation`, `color`, `language`, `sort`, `safety`, `page` |
| `pexels` | `orientation`, `color`, `language`, `media.size`, `page` |
| `pexels-video` | `orientation`, `language`, `media.size`, `page` |
| `pixabay` | `orientation`, `color`, `language`, `sort`, `safety`, `media.kind`, `media.minWidth`, `media.minHeight`, `page` |
| `pixabay-video` | `language`, `sort`, `safety`, `media.kind`, `media.minWidth`, `media.minHeight`, `page` |
| `flickr` | `sort`, `safety`, `license.commercial`, `license.modification`, `license.allowUnknown`, `creator.id`, `page` |
| `openverse`, `openverse-audio` | `license.commercial`, `license.modification`, `license.allowUnknown`, `page` |
| `gutendex` | `language`, `text.copyright`, `page` |
| `brave` | `safety` |
| `artic`, `ambientcg`, `europeana`, `freesound`, `internet-archive`, `jamendo`, `met`, `polyhaven`, `smithsonian`, `wikimedia-commons` | `page` |
| `nailbook`, `poetrydb`, `rijksmuseum` | none — their endpoints expose no stateless control refkit can translate |

A control reaches a provider only if that provider declares it in `capabilities.controls`; everything else is reported as ignored instead of silently dropped.

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
meta.providers  // per-source status: fulfilled / failed / skipped (+ reason), latencyMs, confidence
meta.gate       // before/after/dropped counts when gateFor is used
meta.threshold  // { minRelevance, dropped } when minRelevance is set
meta.passes     // fan-out passes this call ran (> 1 only when a cursor advanced pages)
meta.nextCursor // opaque "load more" token; absent = exhausted
meta.warnings   // partial-result, rights-conflict and gate/threshold-drop notes
```

## Ranking & rerank

Results are fused across sources with **Reciprocal Rank Fusion**, weighted per source by how well that source's batch matched the query, and then reranked for the query. Both are defaults:

- **Source confidence** (`RefkitOptions.sourceConfidence`, default on) weights each source's RRF contribution by `floor + (1 − floor) × hitRate`, where `hitRate` is the fraction of its refs whose text mentions any query token and `floor` is `0.1` — a source is dampened, never erased. `sourceConfidence: false` for unweighted fusion, `{ floor: 0.3 }` to dampen less. Every fulfilled source reports its weight as `meta.providers[].confidence`; a source that returned nothing reports none.
- **`lexicalReranker(opts?)`** is the default reranker: no model, no network. It scores each result over `title + description + tags + text.excerpt` (CJK via character bigrams), blends in the incoming fused relevance (`fusionWeight`, default `0.5`), adds a resolution boost (`qualityWeight` `0.15`) and optionally license permissiveness (`licenseWeight`, default `0`) or the source's own `sourceScore` (`sourceScoreWeight`, default `0`), then emits greedily with a per-source diversity penalty (`sourceDiversity` `0.1`) and a same-source near-duplicate-title penalty (`nearDuplicatePenalty` `0.25` above a title-token Jaccard of `nearDuplicateThreshold` `0.7`). The greedy penalties steer order only; the reported `relevance` is the normalised blend.
- **Replace or disable it** — `RefkitOptions.rerank` sets the client default, `SearchInput.rerank` overrides per call; `false` on either returns raw cross-source fusion order.
- **Bring your own** — the `Reranker` hook receives `{ query, refs, signal }` and returns reordered refs, so you can wire a CLIP/embedding/LLM reranker to your own API. `core` ships no model; this is the only seam. `refText(ref)` and `tokenize(text)` are exported so a custom reranker can read the same text with the same tokenizer.

```ts
import { createRefkit, lexicalReranker } from '@refkit/core'

const refkit = createRefkit({
  providers,
  rerank: lexicalReranker({ fusionWeight: 0.8, qualityWeight: 0.3, licenseWeight: 0.2 }),
})

await refkit.search({ query: 'forest path', modalities: ['image'], rerank: false }) // raw fusion order
```

Reranking runs post-merge, before the relevance threshold, the `gateFor` license filter and the limit.

`SearchInput.minRelevance` (off by default) drops results the ranker scored below the bar and reports `meta.threshold = { minRelevance, dropped }`. Calibrate it against the reranker's *blended* score: under the stock weights a result matching no query term still lands near `0.3` (it keeps its fusion and quality terms) and a full match near `0.95`. The scale does **not** transfer to `rerank: false`, where max-normalised RRF puts the top result at exactly `1` and the rest just below it. A non-finite bar is ignored rather than dropping everything.

Ranking is only as good as the candidate pool: `search` overfetches `limit × poolFactor` per provider (default 4×, capped per source) and narrows to `limit` after merge/rerank/threshold/gate — so dedup and ranking see a wide pool, not a source-truncated slice. Lower `poolFactor` when you query many providers.

## The provider contract

A satellite's `search` returns `EmittedReference[]` — everything the **source** knows and nothing else:

```ts
import { defineProvider, okJson, type EmittedReference, type NormalizedQuery, type ProviderContext } from '@refkit/core'

interface Item { id: string; title: string; caption?: string; subjects?: string[] }

export const example = () => defineProvider({
  id: 'example',
  modalities: ['image'],
  kinds: ['photo'],
  description: 'CC0 example photos',
  capabilities: { controls: ['page'] },
  // Optional topical gate: decline queries this source cannot answer. Pure and
  // fetch-free — it runs before any request, and an explicit `sources` entry
  // bypasses it (see "Source routing & acceptance" in the root README).
  accepts: ({ text }) => /photo|portrait/i.test(text),
  async search(q: NormalizedQuery, ctx: ProviderContext): Promise<EmittedReference[]> {
    const res = await ctx.fetch(`https://example.test/search?q=${encodeURIComponent(q.text)}`, { signal: ctx.signal })
    const { items } = await okJson<{ items: Item[] }>(res, 'example search')
    return items.map(item => ({
      modality: 'image',
      kind: 'photo',
      title: item.title,
      description: item.caption,
      tags: item.subjects,
      sourceUrl: `https://example.test/i/${item.id}`,
      rights: {
        license: 'CC0-1.0',
        rehostPolicy: 'cache-allowed',
        raw: { sourceTerms: 'https://example.test/terms', sourceUrl: `https://example.test/i/${item.id}` },
      },
    }))
  },
})
```

Core validates each item against `emittedReferenceSchema` at the boundary, then `completeReference` stamps the fields that are core's concern — `id` (content-addressed from `providerId` + `sourceUrl`), `source`, `canonicalUrl` (defaults to `sourceUrl`), `verifiedAt`, and a `relevance` of zero until the merge scores it — and truncates to the requested `limit`. A provider never computes an id, never writes provenance or a score, and never post-truncates. A single malformed item is reported and dropped (`meta.providers[].rejected`), not fatal.

`LicenseId` is an **open** string. Known ids carry a row in `LICENSE_FACTS`; anything else resolves to the `unknown` row, which grants nothing. A source whose terms are narrower than the label it declares ships its own `rights.facts` row, and every consumer — the use-gate, the merge's conflict resolution, attribution, the reranker's license boost — reads facts via `factsOf(rights)`, never the id string.

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
- **No re-hosting** — keep `canonicalUrl` + thumbnails only; never store originals. `rights.rehostPolicy` records what the source permits and is validated on every record, but core never acts on it: it is metadata for the host binding to honour.
- **Core stamps its own fields** — `id`, `source`, `canonicalUrl`, `verifiedAt`, `relevance` and the per-provider `limit` come from core, never from a provider.
- **strict-deny** — when rights can't be determined, deny / `needs-review` (never fail-open). Unknown, NonCommercial, NoDerivatives, and "no known copyright restrictions" never map to a usable license. Indeterminate facts (all three axes `'unknown'`) can never be allowed, and a cross-source conflict whose claims are incomparable resolves to `unknown`.

## Not legal advice

`evaluateUse` returns a **conservative heuristic** based on source-declared license/ToS facts. It is **not legal advice** and does not determine legal rights. Every verdict carries a `disclaimer` and a `confidence`. For real legal posture — especially feeding references into AI generation — consult counsel.
