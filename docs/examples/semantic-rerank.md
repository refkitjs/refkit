# Cookbook: BYO-embedding semantic reranker

refkit ships no embedding model — [`lexicalReranker`](../../README.md#ranking--rerank) (term coverage
over title + description + tags + excerpt, the fused cross-source relevance, resolution
and optional license weighting) is the zero-dep **default** reranker, applied to every
search unless you say otherwise. This recipe replaces it with a `Reranker` wired to a
host-provided embeddings endpoint for query-aware semantic ranking.

Imports come only from `@refkit/core`; the embeddings call is the one intentional
seam to your own backend. Note what a custom reranker gives up: core's default blends
the *incoming* fused `relevance` (which carries cross-source agreement and the
per-source confidence weights) into its score, so a reranker that ignores
`ref.relevance` — like the cosine-only one below — makes source confidence a tie-break
and a diagnostic instead of a ranking signal. Read it back in if you want both.

```ts
import { refText, type Reranker, type RerankInput, type Reference } from '@refkit/core'

/** Host-provided endpoint: POST { input: string[] } -> { embeddings: number[][] },
 *  one embedding per input string, same order. Swap in your own provider. */
async function fetchEmbeddings(
  texts: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const res = await fetch('https://your-embeddings-host.example/v1/embed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: texts }),
    signal,
  })
  if (!res.ok) throw new Error(`embeddings request failed: ${res.status}`)
  const { embeddings } = (await res.json()) as { embeddings: number[][] }
  return embeddings
}

function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a))
}

/** Cosine similarity in [-1, 1]; 0 when either vector is zero-length. */
function cosineSimilarity(a: number[], b: number[]): number {
  const denom = norm(a) * norm(b)
  return denom === 0 ? 0 : dot(a, b) / denom
}

/** Semantic reranker: embeds the query and each ref's ranking text (core's
 *  `refText` — title + description + tags + excerpt, the same text the default
 *  reranker reads), scores by cosine similarity, sorts descending, and rewrites
 *  `relevance` to a normalized 0..1 score. Preserves every `referenceSchema`
 *  invariant — refs are copied, never mutated, and none are dropped or
 *  fabricated. */
export function semanticReranker(): Reranker {
  return async ({ query, refs, signal }: RerankInput): Promise<Reference[]> => {
    if (refs.length === 0) return []

    const vectors = await fetchEmbeddings([query, ...refs.map(refText)], signal)
    const expected = 1 + refs.length
    if (vectors.length !== expected) {
      throw new Error(`embeddings count mismatch: got ${vectors.length}, expected ${expected}`)
    }
    const [queryVec, ...refVecs] = vectors

    const scored = refs.map((ref, i) => ({
      ref,
      score: cosineSimilarity(queryVec, refVecs[i]),
    }))
    scored.sort((a, b) => b.score - a.score)

    // Cosine similarity is [-1, 1]; normalize to referenceSchema's required 0..1.
    return scored.map(({ ref, score }) => ({
      ...ref, // copy — never mutate the input ref in place
      relevance: (score + 1) / 2,
    }))
  }
}
```

Usage — passing a `Reranker` **overrides** the lexical default, per client or per call:

```ts
import { createRefkit } from '@refkit/core'
import { semanticReranker } from './semantic-reranker'

// Client-wide: every search goes through the semantic reranker.
const refkit = createRefkit({ providers: [/* ... */], rerank: semanticReranker() })

// Or per call, leaving the client on the lexical default:
const refs = await refkit.search({
  query: 'cyberpunk alley at night',
  modalities: ['image'],
  rerank: semanticReranker(),
})
```

`minRelevance` thresholds the score this reranker writes, so recalibrate the bar for a
cosine-derived scale — the numbers quoted for the lexical default do not carry over.

**Invariants a custom `Reranker` must preserve** (see `Reranker` in `packages/core/src/rerank.ts`):
copy each `Reference` rather than mutating it in place, keep `relevance` within `0..1`,
and return a reorder/subset of the input — no dropped required fields, no duplicated or
fabricated refs.
