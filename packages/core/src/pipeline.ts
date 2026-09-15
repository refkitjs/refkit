// One search pass, as named stages: fan-out → status collection → confidence →
// merge → rerank → threshold → gate → seen-filter. The client owns option
// resolution, the cursor loop and meta assembly; everything a pass needs arrives
// as PassDeps, so a stage is testable on its own and the cursor path can run
// several passes against the same deps.
import type { Reference } from './reference'
import { tokenize, type Reranker } from './rerank'
import { sourceConfidence } from './confidence'
import type { Modality } from './modality'
import type { Intent } from './evaluate-use'
import { evaluateUse } from './evaluate-use'
import type { ProviderOptionsById, ReferenceProvider } from './provider'
import type { SearchControls } from './controls'
import { mergeReferences, type MergeOptions, type RightsConflict } from './merge'
import { normalizeQuery, requestedControlKeys, supportedControlKeys, unsupportedControlKeys } from './query'
import { runProviderSearch, type ProviderRun, type ProviderRunDeps } from './provider-run'
import { cursorSeenKey } from './cursor'
import type { ProviderSkipReason } from './select'
// Types only — the client imports this module, never the other way round.
import type { ProviderSearchStatus, SearchControlsMeta, SearchGateMeta, SearchThresholdMeta } from './client'

export interface PassDeps {
  /** Every configured provider — statuses are reported for all of them. */
  providers: readonly ReferenceProvider[]
  /** The subset this search fans out to (from selectProviders). */
  chosen: readonly ReferenceProvider[]
  skipReasons: Map<string, ProviderSkipReason>
  query: string
  modalities: Modality[]
  controls?: SearchControls
  providerOptions?: ProviderOptionsById
  /** Per-provider candidate budget (the overfetched pool, ≥ the caller's limit). */
  fetchLimit: number
  run: ProviderRunDeps
  /** Max provider searches in flight at once; undefined → all at once. */
  concurrency?: number
  merge?: MergeOptions
  rerank?: Reranker
  /** Weight each source's RRF contribution by how well its batch matches the
   *  query, with this trust floor. Undefined → unweighted fusion. */
  confidence?: { floor: number }
  /** Drop results whose post-rank relevance is below this. Undefined → no
   *  threshold (the default: a caller asking for results wants the best
   *  available, not an empty list). */
  minRelevance?: number
  gateFor?: Intent
  gateContext?: { userJurisdiction?: string }
  /** Already-returned cursor keys to filter out (load-more). */
  seen?: Set<number>
  signal?: AbortSignal
  onProviderError?: (providerId: string, error: unknown) => void
}

export interface PassOutcome {
  refs: Reference[] // post merge/rerank/threshold/gate/seen-filter, best-first
  controlsMeta?: SearchControlsMeta
  statusByProvider: Map<string, ProviderSearchStatus>
  gate?: SearchGateMeta
  threshold?: SearchThresholdMeta
  rightsConflicts: RightsConflict[]
  totalReturned: number // raw items across fulfilled providers (pre-parse)
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

// Bounded-parallel map: at most `limit` fn calls in flight, results in input
// order. fn never rejects here (runProviderSearch returns failures as values).
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** What each provider was asked for vs. what it declares it can honour. */
export function controlsMetaFor(providers: readonly ReferenceProvider[], controls: SearchControls | undefined): SearchControlsMeta | undefined {
  const asked = controls ?? {}
  const requested = requestedControlKeys(asked)
  if (requested.length === 0) return undefined
  return {
    requested,
    appliedByProvider: Object.fromEntries(providers.map(p => [p.id, supportedControlKeys(p, asked)])),
    ignoredByProvider: Object.fromEntries(providers.map(p => [p.id, unsupportedControlKeys(p, asked)])),
  }
}

/** Query every chosen provider, each with its own normalized query. Never
 *  rejects: a provider's failure comes back as `{ ok: false }`. */
export async function fanOut(deps: PassDeps, controls: SearchControls | undefined): Promise<ProviderRun[]> {
  const runProvider = (p: ReferenceProvider) => {
    const query = normalizeQuery({
      query: deps.query,
      modalities: deps.modalities,
      controls,
      providerOptions: deps.providerOptions,
      limit: deps.fetchLimit,
    }, p)
    return runProviderSearch(p, query, { ...deps.run, onError: error => deps.onProviderError?.(p.id, error) })
  }
  return deps.concurrency
    ? mapBounded(deps.chosen, deps.concurrency, runProvider)
    : Promise.all(deps.chosen.map(runProvider))
}

/** Per-provider diagnostics for this pass, plus the ranked lists to merge.
 *  `perSourceIds` is parallel to `perSource` (a failed provider contributes no
 *  list, so index i of `perSource` is not index i of `chosen`). */
export function collectStatuses(deps: PassDeps, runs: readonly ProviderRun[]): {
  statusByProvider: Map<string, ProviderSearchStatus>
  perSource: Reference[][]
  perSourceIds: string[]
  totalReturned: number
} {
  const statusByProvider = new Map<string, ProviderSearchStatus>()
  for (const p of deps.providers) {
    // skipReasons explains WHY a provider sat this search out (sources filter vs
    // wrong modality vs undeclared kind).
    const reason = deps.skipReasons.get(p.id)
    if (reason) statusByProvider.set(p.id, { providerId: p.id, status: 'skipped', reason })
  }
  const perSource: Reference[][] = []
  const perSourceIds: string[] = []
  let totalReturned = 0
  runs.forEach((run, i) => {
    const provider = deps.chosen[i]
    if (run.ok) {
      totalReturned += run.returned
      statusByProvider.set(provider.id, {
        providerId: provider.id,
        status: 'fulfilled',
        returned: run.returned,
        accepted: run.valid.length,
        rejected: run.rejected,
        latencyMs: run.latencyMs,
        ...(run.cached ? { cached: true } : {}),
      })
      perSource.push(run.valid)
      perSourceIds.push(provider.id)
    } else {
      statusByProvider.set(provider.id, { providerId: provider.id, status: 'failed', error: errorSummary(run.error), latencyMs: run.latencyMs })
    }
  })
  return { statusByProvider, perSource, perSourceIds, totalReturned }
}

/** Per-source merge weights from lexical confidence, stamped onto each fulfilled
 *  status so a caller can see which source actually answered the query.
 *  `perSourceIds` is parallel to `perSource` (see collectStatuses). Returns
 *  undefined when confidence weighting is off. */
export function confidenceStage(
  deps: PassDeps,
  perSource: readonly Reference[][],
  perSourceIds: readonly string[],
  statusByProvider: Map<string, ProviderSearchStatus>,
): number[] | undefined {
  if (!deps.confidence) return undefined
  const { floor } = deps.confidence
  const qTokens = [...new Set(tokenize(deps.query))]
  const weights = perSource.map(list => sourceConfidence(qTokens, list, floor))
  perSourceIds.forEach((id, i) => {
    const status = statusByProvider.get(id)
    if (status) statusByProvider.set(id, { ...status, confidence: weights[i] })
  })
  return weights
}

/** Rank fusion across the per-source lists, optionally confidence-weighted.
 *  Cross-source rights conflicts are collected for `meta.warnings` while still
 *  reaching a host-supplied observer. */
export function mergeStage(deps: PassDeps, perSource: Reference[][], weights: number[] | undefined, conflicts: RightsConflict[]): Reference[] {
  return mergeReferences(perSource, {
    ...deps.merge,
    ...(weights ? { weights } : {}),
    onRightsConflict: (c) => {
      conflicts.push(c)
      deps.merge?.onRightsConflict?.(c)
    },
  })
}

/** Rerank over the FULL merged pool, before the license gate — ordering (and a
 *  reranker's batch-relative scoring, e.g. quality normalised across the pool) is
 *  computed against every candidate, then the gate drops denied ones while
 *  preserving order. Core does not re-validate the returned refs; a reranker is
 *  trusted to honour the Reranker contract. */
export async function rerankStage(deps: PassDeps, refs: Reference[]): Promise<Reference[]> {
  return deps.rerank ? deps.rerank({ query: deps.query, refs, signal: deps.signal }) : refs
}

/** Opt-in relevance threshold: drop results the ranker scored below the caller's
 *  bar. Runs after rerank (it is the ranker's score that is being thresholded)
 *  and before the gate, so gate counts describe what the caller could have seen. */
export function applyThreshold(refs: Reference[], minRelevance: number | undefined): { refs: Reference[]; threshold?: SearchThresholdMeta } {
  if (minRelevance === undefined) return { refs }
  const kept = refs.filter(r => r.relevance >= minRelevance)
  return { refs: kept, threshold: { minRelevance, dropped: refs.length - kept.length } }
}

/** Search-time license gate: drop everything the intent does not allow. */
export function applyGate(refs: Reference[], intent: Intent | undefined, ctx?: { userJurisdiction?: string }): { refs: Reference[]; gate?: SearchGateMeta } {
  if (!intent) return { refs }
  const before = refs.length
  const kept = refs.filter(r => evaluateUse(r.rights, intent, ctx).decision.startsWith('allowed'))
  return { refs: kept, gate: { intent, before, after: kept.length, dropped: before - kept.length } }
}

/** Cursor pagination: drop results already returned on earlier calls (RRF pages
 *  overlap by design). Runs AFTER rank/gate so ordering is batch-consistent, but
 *  BEFORE the limit so repeats don't consume the batch budget. */
export function filterSeen(refs: Reference[], seen: Set<number> | undefined): Reference[] {
  return seen ? refs.filter(r => !seen.has(cursorSeenKey(r.canonicalUrl))) : refs
}

/** One full fan-out → confidence → merge → rerank → threshold → gate →
 *  seen-filter pass at the given provider-local page. The cursor path may run
 *  several passes per call. */
export async function runPass(deps: PassDeps, page: number | undefined): Promise<PassOutcome> {
  const controls = page !== undefined ? { ...deps.controls, page } : deps.controls
  const controlsMeta = controlsMetaFor(deps.providers, controls)
  const runs = await fanOut(deps, controls)
  const { statusByProvider, perSource, perSourceIds, totalReturned } = collectStatuses(deps, runs)
  if (deps.chosen.length > 0 && !runs.some(r => r.ok)) {
    throw new AggregateError(runs.filter(r => !r.ok).map(r => (r as { error: unknown }).error), 'refkit.search: all providers failed')
  }
  const rightsConflicts: RightsConflict[] = []
  const weights = confidenceStage(deps, perSource, perSourceIds, statusByProvider)
  const merged = mergeStage(deps, perSource, weights, rightsConflicts)
  const ranked = await rerankStage(deps, merged)
  const thresholded = applyThreshold(ranked, deps.minRelevance)
  const gated = applyGate(thresholded.refs, deps.gateFor, deps.gateContext)
  const refs = filterSeen(gated.refs, deps.seen)
  return { refs, controlsMeta, statusByProvider, gate: gated.gate, threshold: thresholded.threshold, rightsConflicts, totalReturned }
}
