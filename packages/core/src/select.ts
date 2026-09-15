// Provider selection: which configured providers a search fans out to, and why
// each of the others sat it out. Kept separate from the pipeline so the routing
// rules (modality, sources whitelist, kind narrowing) are testable without a
// fan-out, and from the client so option resolution owns nothing but options.
import type { Modality } from './modality'
import type { ReferenceProvider } from './provider'

/** Why a configured provider sat a search out (no fetch attempted). */
export const PROVIDER_SKIP_REASONS = ['unsupported-modality', 'not-selected', 'unsupported-kind'] as const
export type ProviderSkipReason = (typeof PROVIDER_SKIP_REASONS)[number]

export interface ProviderSelection {
  chosen: ReferenceProvider[]
  /** Why each excluded provider sat this search out. */
  skipReasons: Map<string, ProviderSkipReason>
  /** `sources` ids that match no configured provider (tolerated, surfaced as a warning). */
  unknownSources: string[]
}

export interface SelectionInput {
  modalities: Modality[]
  sources?: readonly string[]
  /** `controls.media.kind` — narrows to providers that declare it (undeclared are kept). */
  kind?: string
  text: string
}

/** Decide which providers a search fans out to, with an explanation per exclusion.
 *  Throws when nothing is left: a source-scoped miss is a caller typo and must fail
 *  loudly rather than read as "no results". */
export function selectProviders(providers: readonly ReferenceProvider[], input: SelectionInput): ProviderSelection {
  const skipReasons = new Map<string, ProviderSkipReason>()
  const reasonFor = (p: ReferenceProvider): ProviderSkipReason | undefined => {
    if (!p.modalities.some(m => input.modalities.includes(m))) return 'unsupported-modality'
    if (input.sources != null && !input.sources.includes(p.id)) return 'not-selected'
    // Declaration-gated kind narrowing: providers with no `kinds` declared are
    // conservatively included on kind-filtered queries (same progressive
    // philosophy as capabilities-based control routing).
    if (input.kind !== undefined && p.kinds && !p.kinds.includes(input.kind)) return 'unsupported-kind'
    return undefined
  }
  for (const p of providers) {
    const reason = reasonFor(p)
    if (reason) skipReasons.set(p.id, reason)
  }
  const chosen = providers.filter(p => !skipReasons.has(p.id))
  if (chosen.length === 0) {
    const kindSuffix = input.kind !== undefined ? ` with kind "${input.kind}"` : ''
    if (input.sources != null) {
      throw new Error(`refkit.search: no configured provider matches source id(s) [${input.sources.join(', ')}] for modalities [${input.modalities.join(', ')}]${kindSuffix}`)
    }
    throw new Error(`refkit.search: no registered provider supports modalities [${input.modalities.join(', ')}]${kindSuffix}`)
  }
  // Individual unknown ids (while others still resolved) are tolerated but
  // surfaced — the client routes them into meta.warnings.
  const unknownSources = input.sources ? input.sources.filter(id => !providers.some(p => p.id === id)) : []
  return { chosen, skipReasons, unknownSources }
}
