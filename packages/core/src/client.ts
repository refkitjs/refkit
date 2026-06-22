import type { Reference } from './reference'
import { parseReference } from './reference'
import type { Modality } from './modality'
import type { Intent, Verdict } from './evaluate-use'
import { evaluateUse } from './evaluate-use'
import type { Attribution } from './attribution'
import { buildAttribution } from './attribution'
import type { ReferenceProvider, ProviderContext, KeyValueCache, SearchFilters } from './provider'
import { mergeReferences, type MergeOptions } from './merge'
import { normalizeQuery } from './query'

export interface RefkitOptions {
  providers: ReferenceProvider[]
  fetch?: typeof fetch // optional; defaults to globalThis.fetch
  cache?: KeyValueCache
  signal?: AbortSignal
  merge?: MergeOptions
}

export interface ProviderError {
  providerId: string
  error: unknown
}

export interface SearchInput {
  query: string
  modalities: Modality[]
  filters?: SearchFilters
  limit?: number
  signal?: AbortSignal
  gateFor?: Intent
  onProviderError?: (e: ProviderError) => void
  rerank?: (refs: Reference[]) => Reference[] | Promise<Reference[]>
}

export interface RefkitClient {
  search(input: SearchInput): Promise<Reference[]>
  evaluateUse(ref: Reference, intent: Intent, ctx?: { userJurisdiction?: string }): Verdict
  buildAttribution(ref: Reference): Attribution
  readonly providers: readonly ReferenceProvider[]
}

const DEFAULT_LIMIT = 30

export function createRefkit(options: RefkitOptions): RefkitClient {
  if (!options.providers || options.providers.length === 0) {
    throw new Error('createRefkit: at least one provider is required')
  }

  async function search(input: SearchInput): Promise<Reference[]> {
    const doFetch = options.fetch ?? globalThis.fetch
    if (typeof doFetch !== 'function') {
      throw new Error('createRefkit: no fetch available — pass options.fetch')
    }
    const ctx: ProviderContext = {
      fetch: doFetch,
      cache: options.cache,
      signal: input.signal ?? options.signal,
    }

    const chosen = options.providers.filter(p => p.modalities.some(m => input.modalities.includes(m)))
    if (chosen.length === 0) {
      throw new Error(`refkit.search: no registered provider supports modalities [${input.modalities.join(', ')}]`)
    }
    const settled = await Promise.allSettled(chosen.map(p => p.search(normalizeQuery(input, p), ctx)))

    const perSource: Reference[][] = []
    let anyOk = false
    settled.forEach((res, i) => {
      const provider = chosen[i]
      if (res.status === 'fulfilled') {
        anyOk = true
        const valid: Reference[] = []
        for (const raw of res.value) {
          try {
            valid.push(parseReference(raw))
          } catch (error) {
            input.onProviderError?.({ providerId: provider.id, error })
          }
        }
        perSource.push(valid)
      } else {
        input.onProviderError?.({ providerId: provider.id, error: res.reason })
      }
    })

    if (!anyOk) {
      const reasons = settled
        .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
        .map(s => s.reason)
      throw new AggregateError(reasons, 'refkit.search: all providers failed')
    }

    let refs = mergeReferences(perSource, options.merge)
    if (input.rerank) refs = await input.rerank(refs)
    if (input.gateFor) {
      const intent = input.gateFor
      refs = refs.filter(r => evaluateUse(r.rights, intent).decision.startsWith('allowed'))
    }
    return refs.slice(0, input.limit ?? DEFAULT_LIMIT)
  }

  return {
    search,
    evaluateUse: (ref, intent, ctx) => evaluateUse(ref.rights, intent, ctx),
    buildAttribution: ref =>
      buildAttribution({
        license: ref.rights.license,
        author: ref.rights.author,
        title: ref.title,
        canonicalUrl: ref.canonicalUrl,
      }),
    get providers() {
      return options.providers
    },
  }
}
