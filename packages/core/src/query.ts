import type { Modality } from './modality'
import type { NormalizedQuery, ReferenceProvider, SearchFilters } from './provider'

// Build a per-provider NormalizedQuery: keep only the filters this provider's
// queryFeatures support (silently drop the rest — never error), and intersect modalities.
export function normalizeQuery(
  input: { query: string; modalities: Modality[]; filters?: SearchFilters; limit?: number },
  provider: ReferenceProvider,
): NormalizedQuery {
  const feats = new Set(provider.queryFeatures)
  const filters: SearchFilters = {}
  if (input.filters?.color && feats.has('color')) filters.color = input.filters.color
  if (input.filters?.orientation && feats.has('orientation')) filters.orientation = input.filters.orientation
  if (input.filters?.language && feats.has('language')) filters.language = input.filters.language
  const hasFilters = Object.keys(filters).length > 0
  return {
    text: input.query,
    modalities: input.modalities.filter(m => provider.modalities.includes(m)),
    ...(hasFilters ? { filters } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  }
}
