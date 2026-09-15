// Public API — @refkit/core P0.
export { MODALITIES } from './modality'
export type { Modality } from './modality'
export {
  LICENSE_FACTS, LICENSE_IDS, factsFor, isKnownLicenseId, isIndeterminate,
  compareRestrictiveness, permissivenessScore, CC_VERSIONED_FAMILIES, ccVersionFor,
} from './license'
export type { LicenseId, KnownLicenseId, LicenseFacts, Tri } from './license'
export type { RehostPolicy, RightsRecord } from './rights'
export { rightsRecordSchema, licenseFactsSchema, factsOf } from './rights'
export { buildAttribution } from './attribution'
export type { Attribution, AttributionInput } from './attribution'
export type {
  EmittedReference,
  Reference,
  ReferenceMedia,
  MediaPreview,
  VisualMeta,
  TextMeta,
} from './reference'
export {
  emittedReferenceSchema, referenceSchema,
  parseEmitted, parseReference, completeReference,
} from './reference'
export { fnv1a } from './hash'
export { canonicalizeUrl, referenceId } from './dedup-key'
export { hammingDistance, dedupeReferences } from './dedup'
export type { DedupeOptions } from './dedup'
export { mergeReferences } from './merge'
export type { MergeOptions, RightsConflict } from './merge'
export { evaluateUse, evaluatePermissions, NOT_LEGAL_ADVICE, INTENTS } from './evaluate-use'
export type { Intent, Decision, Verdict, PermissionKey, EvaluateOptions } from './evaluate-use'
export {
  CONTROL_PATHS, SEARCH_CONTROL_KEYS, getControl, setControl, hasControl,
  buildSearchControlsSchema, searchControlsSchema,
} from './controls'
export type {
  SearchControls,
  SearchControlKey,
  SearchSort,
  SearchSafety,
  SearchLicenseControls,
  SearchMediaControls,
  SearchCreatorControls,
  SearchTextControls,
  WellKnownKind,
  ResourceKind,
} from './controls'
export { searchMetaSchema, providerSearchStatusSchema, searchControlKeySchema } from './schemas'
export { defineProvider } from './provider'
export type {
  ReferenceProvider,
  ProviderContext,
  NormalizedQuery,
  ProviderCapabilities,
  ProviderOptionValue,
  ProviderOptions,
  ProviderOptionsById,
  KeyValueCache,
} from './provider'
export {
  setIfString, setIfBoolean, setIfStringList,
  setIfInt, setIfPositiveInt, setIfNonNegativeInt, setIfNumber, offsetForPage,
  first, plainText, mapCcDeedUrl, mapRightsUrl, CC_FAMILY_BY_TOKEN,
  isLikelyImageUrl, imageMediaType, IMAGE_EXT, okJson,
} from './provider-helpers'
export { normalizeQuery } from './query'
export { runProviderSearch, providerCacheKey, stableStringify } from './provider-run'
export type { ProviderRun, ProviderRunDeps } from './provider-run'
export { selectProviders, PROVIDER_SKIP_REASONS } from './select'
export type { ProviderSkipReason, ProviderSelection } from './select'
export { runPass } from './pipeline'
export type { PassDeps, PassOutcome } from './pipeline'
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
export { withTimeout, retryingFetch, withDefaultUserAgent } from './resilience'
export type { TimeoutHandle, RetryOptions } from './resilience'
