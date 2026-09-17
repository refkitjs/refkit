import { z } from 'zod'

export type SearchSort = 'relevance' | 'latest' | 'popular' | 'interesting'
export type SearchSafety = 'strict' | 'moderate' | 'off'

/** Fine-grained resource kind. Open vocabulary: well-known values get
 *  autocomplete; any other string is a valid custom kind. Well-known values are
 *  hints, not validation — core never rejects unknown kinds. */
export type WellKnownKind =
  | 'photo' | 'illustration' | 'vector' | 'icon' | 'artwork'
  | 'texture' | 'hdri' | '3d-model'
  | 'film' | 'animation'
  | 'music' | 'sound-effect'
  | 'ebook' | 'poem'
export type ResourceKind = WellKnownKind | (string & {})

export interface SearchLicenseControls {
  commercial?: boolean
  modification?: boolean
  allowUnknown?: boolean
}

export interface SearchMediaControls {
  kind?: ResourceKind
  size?: 'small' | 'medium' | 'large'
  minWidth?: number
  minHeight?: number
  duration?: 'short' | 'medium' | 'long'
}

export interface SearchCreatorControls {
  id?: string
  name?: string
}

export interface SearchTextControls {
  copyright?: 'public-domain' | 'copyrighted' | 'any'
}

export interface SearchControls {
  orientation?: 'landscape' | 'portrait' | 'square'
  color?: string
  language?: string
  sort?: SearchSort
  safety?: SearchSafety
  license?: SearchLicenseControls
  media?: SearchMediaControls
  creator?: SearchCreatorControls
  text?: SearchTextControls
  /** Provider-local page cursor: each provider paginates its own result stream;
   *  after RRF merging, page N+1 may overlap or shift relative to page N. For
   *  UI "load more", dedupe across pages by canonicalUrl (see README). */
  page?: number
}

/** The single control registry: every routable control as its path inside
 *  SearchControls. The key union, key list, accessors and zod schema all derive
 *  from this table — adding a control means adding one row here (and one field
 *  in SearchControls + the schema builder below). */
export const CONTROL_PATHS = {
  orientation: ['orientation'],
  color: ['color'],
  language: ['language'],
  sort: ['sort'],
  safety: ['safety'],
  'license.commercial': ['license', 'commercial'],
  'license.modification': ['license', 'modification'],
  'license.allowUnknown': ['license', 'allowUnknown'],
  'media.kind': ['media', 'kind'],
  'media.size': ['media', 'size'],
  'media.minWidth': ['media', 'minWidth'],
  'media.minHeight': ['media', 'minHeight'],
  'media.duration': ['media', 'duration'],
  'creator.id': ['creator', 'id'],
  'creator.name': ['creator', 'name'],
  'text.copyright': ['text', 'copyright'],
  page: ['page'],
} as const satisfies Record<string, readonly [keyof SearchControls] | readonly [keyof SearchControls, string]>

export type SearchControlKey = keyof typeof CONTROL_PATHS
export const SEARCH_CONTROL_KEYS: readonly SearchControlKey[] = Object.keys(CONTROL_PATHS) as SearchControlKey[]

type Path = readonly [keyof SearchControls, string?]

export function getControl(controls: SearchControls, key: SearchControlKey): unknown {
  const [head, tail] = CONTROL_PATHS[key] as Path
  const value = controls[head]
  return tail === undefined ? value : (value as Record<string, unknown> | undefined)?.[tail]
}

export function hasControl(controls: SearchControls, key: SearchControlKey): boolean {
  return getControl(controls, key) !== undefined
}

/** Write `value` at the key's path (creating the nested group as needed). */
export function setControl(out: SearchControls, key: SearchControlKey, value: unknown): void {
  const [head, tail] = CONTROL_PATHS[key] as Path
  const target = out as Record<string, unknown>
  if (tail === undefined) {
    target[head] = value
    return
  }
  target[head] = { ...((target[head] as Record<string, unknown> | undefined) ?? {}), [tail]: value }
}

/** Zod schema for SearchControls. `kinds` restricts media.kind to a closed enum
 *  (the MCP server passes the union of registered providers' kinds). */
export function buildSearchControlsSchema(kinds?: readonly string[]): z.ZodType<SearchControls> {
  const kind = kinds && kinds.length > 0 ? z.enum(kinds as [string, ...string[]]) : z.string()
  return z.object({
    orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
    color: z.string().optional(),
    language: z.string().optional(),
    sort: z.enum(['relevance', 'latest', 'popular', 'interesting']).optional(),
    safety: z.enum(['strict', 'moderate', 'off']).optional(),
    license: z.object({
      commercial: z.boolean().optional(),
      modification: z.boolean().optional(),
      allowUnknown: z.boolean().optional(),
    }).optional(),
    media: z.object({
      kind: kind.optional(),
      size: z.enum(['small', 'medium', 'large']).optional(),
      minWidth: z.number().int().nonnegative().optional(),
      minHeight: z.number().int().nonnegative().optional(),
      duration: z.enum(['short', 'medium', 'long']).optional(),
    }).optional(),
    creator: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
    text: z.object({ copyright: z.enum(['public-domain', 'copyrighted', 'any']).optional() }).optional(),
    page: z.number().int().positive().optional(),
  })
}

export const searchControlsSchema: z.ZodType<SearchControls> = buildSearchControlsSchema()
