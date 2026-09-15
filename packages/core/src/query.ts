import type { Modality } from './modality'
import type { NormalizedQuery, ProviderOptionsById, ReferenceProvider } from './provider'
import {
  SEARCH_CONTROL_KEYS,
  getControl,
  hasControl,
  setControl,
  type SearchControlKey,
  type SearchControls,
} from './controls'

// A control reaches a provider only if that provider declares it. A provider
// without `capabilities` declares nothing, so it receives no controls — better
// an unfiltered-but-honest search than a silently ignored constraint.
function effectiveControlCaps(provider: ReferenceProvider): readonly SearchControlKey[] {
  return provider.capabilities?.controls ?? []
}

export function requestedControlKeys(controls: SearchControls): SearchControlKey[] {
  return SEARCH_CONTROL_KEYS.filter(key => hasControl(controls, key))
}

export function supportedControlKeys(provider: ReferenceProvider, controls: SearchControls): SearchControlKey[] {
  return effectiveControlCaps(provider).filter(key => hasControl(controls, key))
}

export function unsupportedControlKeys(provider: ReferenceProvider, controls: SearchControls): SearchControlKey[] {
  const requested = requestedControlKeys(controls)
  const supported = new Set(effectiveControlCaps(provider))
  return requested.filter(key => !supported.has(key))
}

function normalizeControlsForProvider(controls: SearchControls | undefined, provider: ReferenceProvider): SearchControls | undefined {
  if (!controls) return undefined
  const supported = supportedControlKeys(provider, controls)
  if (supported.length === 0) return undefined
  const out: SearchControls = {}
  for (const key of supported) setControl(out, key, getControl(controls, key))
  return out
}

export function normalizeQuery(
  input: { query: string; modalities: Modality[]; controls?: SearchControls; providerOptions?: ProviderOptionsById; limit?: number },
  provider: ReferenceProvider,
): NormalizedQuery {
  const controls = normalizeControlsForProvider(input.controls, provider)
  return {
    text: input.query,
    modalities: input.modalities.filter(m => provider.modalities.includes(m)),
    ...(controls ? { controls } : {}),
    ...(input.providerOptions?.[provider.id] ? { providerOptions: input.providerOptions[provider.id] } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  }
}
