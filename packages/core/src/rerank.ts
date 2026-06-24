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

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'with',
  'by', 'from', 'as', 'is', 'are', 'it', 'this', 'that',
])

/** Lowercase, split on runs of non-alphanumerics, drop stopwords and 1-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}
