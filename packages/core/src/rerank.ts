import type { Reference } from './reference'

/** The arguments a {@link Reranker} receives: the user query, the merged
 *  candidate refs (read-only — copy before reordering), and the search's
 *  abort signal. */
export interface RerankInput {
  query: string
  refs: readonly Reference[]
  signal?: AbortSignal
}

/** A post-merge reordering strategy, injected via `SearchInput.rerank`. Pure or
 *  async — e.g. a CLIP/embedding reranker the host wires to its own API. Core
 *  ships no model; this is the only seam. */
export type Reranker = (input: RerankInput) => Reference[] | Promise<Reference[]>
