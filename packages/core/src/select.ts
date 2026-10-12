// Provider selection: which configured providers a search fans out to, and why
// each of the others sat it out. Kept separate from the pipeline so the routing
// rules (modality, sources whitelist, kind narrowing, per-provider acceptance)
// are testable without a fan-out, and from the client so option resolution owns
// nothing but options.
import type { Modality } from './modality'
import type { ReferenceProvider } from './provider'

/** Why a configured source sat a search out (no fetch attempted). */
export const SOURCE_SKIP_REASONS = ['unsupported-modality', 'not-selected', 'unsupported-kind', 'declined'] as const
export type SourceSkipReason = (typeof SOURCE_SKIP_REASONS)[number]

/** The `code` values of a {@link SourceSelectionError}. */
export const SOURCE_SELECTION_ERROR_CODES = ['no-matching-source', 'no-source-for-query'] as const
export type SourceSelectionErrorCode = (typeof SOURCE_SELECTION_ERROR_CODES)[number]

/** Thrown when a search has no source to fan out to. A host branches on `code`
 *  and the fields, never on the message, and recognises the error with
 *  {@link isSourceSelectionError} rather than `instanceof`:
 *  - `'no-matching-source'`: `sources` was given and none of it can serve this
 *    search (an unknown id, a known id lacking the modality or the kind, or
 *    `sources: []`) — a caller mistake to report back with the valid ids;
 *  - `'no-source-for-query'`: no `sources`, and no configured source supports
 *    the modalities (and kind) asked for. */
export class SourceSelectionError extends Error {
  readonly code: SourceSelectionErrorCode
  /** The `sources` as passed; absent when the search was unscoped. */
  readonly requested?: string[]
  /** Ids in `sources` that match no configured source. */
  readonly unknown: string[]
  readonly modalities: Modality[]
  /** `controls.media.kind`, when the search narrowed by kind. */
  readonly kind?: string

  constructor(fields: {
    code: SourceSelectionError['code']
    requested?: string[]
    unknown: string[]
    modalities: Modality[]
    kind?: string
  }) {
    const kindSuffix = fields.kind !== undefined ? ` with kind "${fields.kind}"` : ''
    const modalities = `modalities [${fields.modalities.join(', ')}]${kindSuffix}`
    super(fields.code === 'no-matching-source'
      ? `refkit.search: no configured source matches id(s) [${(fields.requested ?? []).join(', ')}] for ${modalities}`
      : `refkit.search: no configured source supports ${modalities}`)
    this.name = 'SourceSelectionError'
    this.code = fields.code
    if (fields.requested !== undefined) this.requested = fields.requested
    this.unknown = fields.unknown
    this.modalities = fields.modalities
    if (fields.kind !== undefined) this.kind = fields.kind
  }
}

/** True for a {@link SourceSelectionError} thrown by any copy of `@refkit/core`.
 *  `instanceof` only recognises this copy's class, and a host can load two (a
 *  client built with its own core handed to `@refkit/mcp`, or core bundled
 *  twice). So past `instanceof` this reads the stable fields — `name`, a string
 *  `message` (callers interpolate it), a known `code`, and the `unknown` and
 *  `modalities` arrays — and never parses the message. */
export function isSourceSelectionError(e: unknown): e is SourceSelectionError {
  if (e instanceof SourceSelectionError) return true
  if (typeof e !== 'object' || e === null) return false
  const x = e as Record<string, unknown>
  return x.name === 'SourceSelectionError'
    && typeof x.message === 'string'
    && typeof x.code === 'string'
    && (SOURCE_SELECTION_ERROR_CODES as readonly string[]).includes(x.code)
    && Array.isArray(x.unknown)
    && Array.isArray(x.modalities)
}

export interface ProviderSelection {
  chosen: ReferenceProvider[]
  /** Why each excluded provider sat this search out. */
  skipReasons: Map<string, SourceSkipReason>
  /** `sources` ids that match no configured source (tolerated, surfaced as a warning). */
  unknownSources: string[]
}

export interface SelectionInput {
  modalities: Modality[]
  sources?: readonly string[]
  /** `controls.media.kind` — narrows to providers that declare it (undeclared are kept). */
  kind?: string
  /** The query text, offered to each provider's own `accepts` predicate. */
  text: string
}

/** Decide which providers a search fans out to, with an explanation per exclusion.
 *  Throws a {@link SourceSelectionError} when nothing is left: a source-scoped
 *  miss is a caller typo and must fail loudly rather than read as "no results" —
 *  EXCEPT when a provider declined the query itself, which is a real "this
 *  source has nothing for you", not a typo. */
export function selectProviders(providers: readonly ReferenceProvider[], input: SelectionInput): ProviderSelection {
  const skipReasons = new Map<string, SourceSkipReason>()
  const reasonFor = (p: ReferenceProvider): SourceSkipReason | undefined => {
    if (!p.modalities.some(m => input.modalities.includes(m))) return 'unsupported-modality'
    if (input.sources != null && !input.sources.includes(p.id)) return 'not-selected'
    // Declaration-gated kind narrowing: providers with no `kinds` declared are
    // conservatively included on kind-filtered queries (same progressive
    // philosophy as capabilities-based control routing).
    if (input.kind !== undefined && p.kinds && !p.kinds.includes(input.kind)) return 'unsupported-kind'
    // The provider's own topical predicate, consulted last (it is the most
    // specific rule) and only on an unscoped search: naming a source explicitly
    // is the caller overriding the source's own judgement.
    if (input.sources == null && p.accepts && !p.accepts({ text: input.text, modalities: input.modalities })) return 'declined'
    return undefined
  }
  for (const p of providers) {
    const reason = reasonFor(p)
    if (reason) skipReasons.set(p.id, reason)
  }
  const chosen = providers.filter(p => !skipReasons.has(p.id))
  // Individual unknown ids (while others still resolved) are tolerated but
  // surfaced — the client routes them into meta.warnings.
  const unknownSources = input.sources ? input.sources.filter(id => !providers.some(p => p.id === id)) : []
  // A decline anywhere in the set means at least one provider COULD have served
  // this modality and judged the query outside its domain — an honest empty
  // result, not a routing mistake, so the pipeline runs a no-provider pass.
  const someDeclined = [...skipReasons.values()].includes('declined')
  if (chosen.length === 0 && !someDeclined) {
    throw new SourceSelectionError({
      code: input.sources != null ? 'no-matching-source' : 'no-source-for-query',
      ...(input.sources != null ? { requested: [...input.sources] } : {}),
      unknown: unknownSources,
      modalities: [...input.modalities],
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
    })
  }
  return { chosen, skipReasons, unknownSources }
}
