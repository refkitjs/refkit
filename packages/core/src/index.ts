// Public API — @refkit/core P0.
export type { Modality } from './modality'
export { LICENSE_FACTS, factsFor, LICENSE_IDS } from './license'
export type { LicenseId, LicenseFacts, Tri } from './license'
export type { RehostPolicy, RightsRecord } from './rights'
export { rightsRecordSchema } from './rights'
export { buildAttribution } from './attribution'
export type { Attribution, AttributionInput } from './attribution'
export type {
  Reference,
  ReferenceMedia,
  MediaPreview,
  VisualMeta,
  TextMeta,
} from './reference'
export { referenceSchema, parseReference } from './reference'
export { fnv1a } from './hash'
export { canonicalizeUrl, referenceId } from './dedup-key'
export { hammingDistance, dedupeReferences } from './dedup'
export type { DedupeOptions } from './dedup'
export { mergeReferences } from './merge'
export type { MergeOptions } from './merge'
export { evaluateUse, NOT_LEGAL_ADVICE } from './evaluate-use'
export type { Intent, Decision, Verdict } from './evaluate-use'
export { defineProvider } from './provider'
export type {
  ReferenceProvider,
  ProviderContext,
  QueryFeature,
  NormalizedQuery,
  SearchFilters,
  SearchControls,
  SearchControlKey,
  SearchSort,
  SearchSafety,
  SearchLicenseControls,
  SearchMediaControls,
  SearchCreatorControls,
  SearchTextControls,
  ProviderCapabilities,
  ProviderOptionValue,
  ProviderOptions,
  ProviderOptionsById,
  KeyValueCache,
} from './provider'
export {
  setIfString, setIfBoolean, setIfStringList,
  setIfInt, setIfPositiveInt, setIfNonNegativeInt, setIfNumber,
  first, mapCcDeedUrl, mapRightsUrl, ccVersionFor, CC_FAMILY_BY_TOKEN,
  isLikelyImageUrl, imageMediaType, IMAGE_EXT,
} from './provider-helpers'
export { normalizeQuery } from './query'
export { createRefkit } from './client'
export type {
  RefkitClient,
  RefkitOptions,
  ResilienceOptions,
  SearchInput,
  SearchResult,
  SearchMeta,
  SearchControlsMeta,
  SearchGateMeta,
  ProviderSearchStatus,
  ProviderError,
} from './client'
export { lexicalReranker, tokenize } from './rerank'
export type { Reranker, RerankInput, LexicalRerankOptions } from './rerank'
export { withTimeout, retryingFetch } from './resilience'
export type { TimeoutHandle, RetryOptions } from './resilience'
