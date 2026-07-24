#!/usr/bin/env node
// Zero-config entry: `npx @refkit/mcp` boots a working MCP server with the keyless
// providers, plus any BYOK provider whose key is in the environment. No host code.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRefkit, type ReferenceProvider } from '@refkit/core'
import { openverse, openverseAudio } from '@refkit/provider-openverse'
import { wikimediaCommons } from '@refkit/provider-wikimedia-commons'
import { met } from '@refkit/provider-met'
import { artic } from '@refkit/provider-artic'
import { gutendex } from '@refkit/provider-gutendex'
import { poetrydb } from '@refkit/provider-poetrydb'
import { rijksmuseum } from '@refkit/provider-rijksmuseum'
import { polyhaven, ambientcg } from '@refkit/provider-polyhaven'
import { internetArchive } from '@refkit/provider-internet-archive'
import { nailbook } from '@refkit/provider-nailbook'
import { serveStdio } from './index'

/** One BYOK source: its unified + legacy env var names, and a lazy loader for its
 *  (optional) provider package. Loaded only when a key is present, so installs
 *  that omitted optionalDependencies still boot — the missing source is skipped
 *  with a stderr warning instead of crashing the server. */
interface ByokSource {
  pkg: string
  key: (env: NodeJS.ProcessEnv) => string | undefined
  load: (key: string) => Promise<ReferenceProvider[]>
}

// Env var convention: each BYOK key is read as `REFKIT_<PROVIDER>_KEY` first (the
// unified name), falling back to the provider's legacy env var name — both are
// honored indefinitely, the unified name is just preferred going forward.
// Exported so tests can assert this table stays in sync with the package's
// optionalDependencies — an entry in one but not the other ships a source that
// either can never load or never installs.
export const BYOK_SOURCES: ByokSource[] = [
  {
    pkg: '@refkit/provider-unsplash',
    key: (env) => env.REFKIT_UNSPLASH_KEY ?? env.UNSPLASH_KEY,
    load: async (accessKey) => [(await import('@refkit/provider-unsplash')).unsplash({ accessKey })],
  },
  {
    pkg: '@refkit/provider-pexels',
    key: (env) => env.REFKIT_PEXELS_KEY ?? env.PEXELS_KEY,
    load: async (apiKey) => {
      const m = await import('@refkit/provider-pexels')
      return [m.pexels({ apiKey }), m.pexelsVideo({ apiKey })]
    },
  },
  {
    pkg: '@refkit/provider-pixabay',
    key: (env) => env.REFKIT_PIXABAY_KEY ?? env.PIXABAY_KEY,
    load: async (key) => {
      const m = await import('@refkit/provider-pixabay')
      return [m.pixabay({ key }), m.pixabayVideo({ key })]
    },
  },
  {
    pkg: '@refkit/provider-flickr',
    key: (env) => env.REFKIT_FLICKR_KEY ?? env.FLICKR_KEY,
    load: async (apiKey) => [(await import('@refkit/provider-flickr')).flickr({ apiKey })],
  },
  {
    pkg: '@refkit/provider-smithsonian',
    key: (env) => env.REFKIT_SMITHSONIAN_KEY ?? env.SI_KEY,
    load: async (apiKey) => [(await import('@refkit/provider-smithsonian')).smithsonian({ apiKey })],
  },
  {
    pkg: '@refkit/provider-brave',
    key: (env) => env.REFKIT_BRAVE_KEY ?? env.BRAVE_TOKEN,
    load: async (token) => [(await import('@refkit/provider-brave')).brave({ token })],
  },
  {
    pkg: '@refkit/provider-freesound',
    key: (env) => env.REFKIT_FREESOUND_KEY ?? env.FREESOUND_TOKEN,
    load: async (apiKey) => [(await import('@refkit/provider-freesound')).freesound({ apiKey })],
  },
  {
    pkg: '@refkit/provider-jamendo',
    key: (env) => env.REFKIT_JAMENDO_CLIENT_ID ?? env.JAMENDO_CLIENT_ID,
    load: async (clientId) => [(await import('@refkit/provider-jamendo')).jamendo({ clientId })],
  },
  {
    pkg: '@refkit/provider-europeana',
    key: (env) => env.REFKIT_EUROPEANA_KEY ?? env.EUROPEANA_KEY,
    load: async (apiKey) => [(await import('@refkit/provider-europeana')).europeana({ apiKey })],
  },
]

/** Providers a zero-config server boots with: all keyless sources (hard deps,
 *  statically imported), plus any BYOK source whose key is present in `env`
 *  (optionalDependencies, dynamically imported on demand). Exported so the
 *  wiring is unit-testable. */
export async function defaultProviders(env: NodeJS.ProcessEnv = process.env): Promise<ReferenceProvider[]> {
  const providers: ReferenceProvider[] = [
    openverse(), openverseAudio(), wikimediaCommons(), met(), artic(), gutendex(), poetrydb(),
    rijksmuseum(), polyhaven(), ambientcg(), internetArchive(), nailbook(),
  ]
  // Independent module loads — run them concurrently (startup cost = max, not sum)
  // and keep BYOK_SOURCES order in the provider list.
  const loaded = await Promise.all(BYOK_SOURCES.map(async (source) => {
    const key = source.key(env)
    if (!key) return []
    try {
      return await source.load(key)
    } catch (err) {
      // stderr only — stdout is the MCP transport. Only a genuinely missing
      // module gets the "not installed" hint; anything else (factory throw,
      // broken transitive import) surfaces the REAL error so the operator
      // doesn't chase the wrong remediation.
      const code = (err as { code?: string } | null)?.code
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
        console.error(`[refkit-mcp] key for ${source.pkg} is set but the package is not installed — skipping this source. Reinstall @refkit/mcp with optional dependencies (or add ${source.pkg}) to enable it.`)
      } else {
        console.error(`[refkit-mcp] failed to initialize ${source.pkg} — skipping this source.`, err)
      }
      return []
    }
  }))
  for (const group of loaded) providers.push(...group)
  return providers
}

// Boot only when run as the CLI entry — not when imported (e.g. by tests). realpath
// so an npm bin symlink resolves to this file.
const isEntry = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

/** Cursor size knob for size-clamped tool-output channels: REFKIT_MAX_CURSOR_SEEN
 *  caps how many already-returned keys the load-more cursor remembers (see
 *  RefkitOptions.maxCursorSeen in @refkit/core — default 500 ≈ 2.7k chars of
 *  nextCursor). Invalid values warn on stderr and fall back to that default. */
export function maxCursorSeenFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.REFKIT_MAX_CURSOR_SEEN
  if (raw === undefined || raw === '') return undefined
  // Strict decimal digits only — Number()'s hex/exponent/whitespace leniency
  // would silently accept values like '1e100' that defeat the cap entirely.
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(n) || n < 1) {
    console.error(`[refkit-mcp] ignoring invalid REFKIT_MAX_CURSOR_SEEN=${JSON.stringify(raw)} — expected a positive integer.`)
    return undefined
  }
  return n
}

if (isEntry) {
  const maxCursorSeen = maxCursorSeenFromEnv()
  await serveStdio(createRefkit({
    providers: await defaultProviders(),
    ...(maxCursorSeen !== undefined ? { maxCursorSeen } : {}),
  }))
}
