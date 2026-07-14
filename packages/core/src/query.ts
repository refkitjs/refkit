import type { Modality } from './modality'
import type {
  NormalizedQuery,
  ProviderOptionsById,
  ReferenceProvider,
  SearchControlKey,
  SearchControls,
  SearchFilters,
} from './provider'

function controlsFromFilters(filters: SearchFilters | undefined): SearchControls {
  if (!filters) return {}
  return {
    ...(filters.orientation ? { orientation: filters.orientation } : {}),
    ...(filters.color ? { color: filters.color } : {}),
    ...(filters.language ? { language: filters.language } : {}),
  }
}

export function mergeSearchControls(controls: SearchControls | undefined, filters: SearchFilters | undefined): SearchControls {
  return { ...controlsFromFilters(filters), ...(controls ?? {}) }
}

function hasControl(controls: SearchControls, key: SearchControlKey): boolean {
  switch (key) {
    case 'orientation': return controls.orientation !== undefined
    case 'color': return controls.color !== undefined
    case 'language': return controls.language !== undefined
    case 'sort': return controls.sort !== undefined
    case 'safety': return controls.safety !== undefined
    case 'license.commercial': return controls.license?.commercial !== undefined
    case 'license.modification': return controls.license?.modification !== undefined
    case 'license.allowUnknown': return controls.license?.allowUnknown !== undefined
    case 'media.kind': return controls.media?.kind !== undefined
    case 'media.size': return controls.media?.size !== undefined
    case 'media.minWidth': return controls.media?.minWidth !== undefined
    case 'media.minHeight': return controls.media?.minHeight !== undefined
    case 'media.duration': return controls.media?.duration !== undefined
    case 'creator.id': return controls.creator?.id !== undefined
    case 'creator.name': return controls.creator?.name !== undefined
    case 'text.copyright': return controls.text?.copyright !== undefined
    case 'page': return controls.page !== undefined
  }
}

function setControl(out: SearchControls, key: SearchControlKey, controls: SearchControls) {
  switch (key) {
    case 'orientation': out.orientation = controls.orientation; return
    case 'color': out.color = controls.color; return
    case 'language': out.language = controls.language; return
    case 'sort': out.sort = controls.sort; return
    case 'safety': out.safety = controls.safety; return
    case 'license.commercial': out.license = { ...(out.license ?? {}), commercial: controls.license?.commercial }; return
    case 'license.modification': out.license = { ...(out.license ?? {}), modification: controls.license?.modification }; return
    case 'license.allowUnknown': out.license = { ...(out.license ?? {}), allowUnknown: controls.license?.allowUnknown }; return
    case 'media.kind': out.media = { ...(out.media ?? {}), kind: controls.media?.kind }; return
    case 'media.size': out.media = { ...(out.media ?? {}), size: controls.media?.size }; return
    case 'media.minWidth': out.media = { ...(out.media ?? {}), minWidth: controls.media?.minWidth }; return
    case 'media.minHeight': out.media = { ...(out.media ?? {}), minHeight: controls.media?.minHeight }; return
    case 'media.duration': out.media = { ...(out.media ?? {}), duration: controls.media?.duration }; return
    case 'creator.id': out.creator = { ...(out.creator ?? {}), id: controls.creator?.id }; return
    case 'creator.name': out.creator = { ...(out.creator ?? {}), name: controls.creator?.name }; return
    case 'text.copyright': out.text = { ...(out.text ?? {}), copyright: controls.text?.copyright }; return
    case 'page': out.page = controls.page; return
  }
}

export function requestedControlKeys(controls: SearchControls): SearchControlKey[] {
  const allControlKeys: SearchControlKey[] = [
    'orientation', 'color', 'language', 'sort', 'safety',
    'license.commercial', 'license.modification', 'license.allowUnknown',
    'media.kind', 'media.size', 'media.minWidth', 'media.minHeight', 'media.duration',
    'creator.id', 'creator.name', 'text.copyright', 'page',
  ]
  return allControlKeys.filter(key => hasControl(controls, key))
}

export function supportedControlKeys(provider: ReferenceProvider, controls: SearchControls): SearchControlKey[] {
  const caps = provider.capabilities?.controls ?? []
  return caps.filter(key => hasControl(controls, key))
}

export function unsupportedControlKeys(provider: ReferenceProvider, controls: SearchControls): SearchControlKey[] {
  const requested = requestedControlKeys(controls)
  const supported = new Set(provider.capabilities?.controls ?? [])
  return requested.filter(key => !supported.has(key))
}

export function normalizeControlsForProvider(input: {
  controls?: SearchControls
  filters?: SearchFilters
}, provider: ReferenceProvider): SearchControls | undefined {
  const merged = mergeSearchControls(input.controls, input.filters)
  const supported = supportedControlKeys(provider, merged)
  if (supported.length === 0) return undefined
  const out: SearchControls = {}
  for (const key of supported) setControl(out, key, merged)
  return out
}

export function normalizeQuery(
  input: { query: string; modalities: Modality[]; filters?: SearchFilters; controls?: SearchControls; providerOptions?: ProviderOptionsById; limit?: number },
  provider: ReferenceProvider,
): NormalizedQuery {
  // Single-track routing: legacy `filters` are merged into `controls` (controls
  // win on conflict) and routed by `capabilities.controls` alone. The deprecated
  // NormalizedQuery.filters channel is then DERIVED from the routed controls, so
  // a provider reading either channel sees the same values — no double semantics.
  const controls = normalizeControlsForProvider(input, provider)
  const filters: SearchFilters = {}
  if (controls?.color) filters.color = controls.color
  if (controls?.orientation) filters.orientation = controls.orientation
  if (controls?.language) filters.language = controls.language
  const hasFilters = Object.keys(filters).length > 0
  return {
    text: input.query,
    modalities: input.modalities.filter(m => provider.modalities.includes(m)),
    ...(hasFilters ? { filters } : {}),
    ...(controls ? { controls } : {}),
    ...(input.providerOptions?.[provider.id] ? { providerOptions: input.providerOptions[provider.id] } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  }
}
