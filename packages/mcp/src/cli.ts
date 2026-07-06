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
import { unsplash } from '@refkit/provider-unsplash'
import { pexels, pexelsVideo } from '@refkit/provider-pexels'
import { pixabay, pixabayVideo } from '@refkit/provider-pixabay'
import { flickr } from '@refkit/provider-flickr'
import { smithsonian } from '@refkit/provider-smithsonian'
import { brave } from '@refkit/provider-brave'
import { rijksmuseum } from '@refkit/provider-rijksmuseum'
import { polyhaven, ambientcg } from '@refkit/provider-polyhaven'
import { freesound } from '@refkit/provider-freesound'
import { jamendo } from '@refkit/provider-jamendo'
import { europeana } from '@refkit/provider-europeana'
import { internetArchive } from '@refkit/provider-internet-archive'
import { serveStdio } from './index'

/** Providers a zero-config server boots with: all keyless sources, plus any BYOK
 *  source whose key is present in `env`. Exported so the wiring is unit-testable.
 *
 *  Env var convention: each BYOK key is read as `REFKIT_<PROVIDER>_KEY` first (the
 *  unified name), falling back to the provider's legacy env var name — both are
 *  honored indefinitely, the unified name is just preferred going forward. */
export function defaultProviders(env: NodeJS.ProcessEnv = process.env): ReferenceProvider[] {
  const providers: ReferenceProvider[] = [
    openverse(), openverseAudio(), wikimediaCommons(), met(), artic(), gutendex(), poetrydb(),
    rijksmuseum(), polyhaven(), ambientcg(), internetArchive(),
  ]
  const unsplashKey = env.REFKIT_UNSPLASH_KEY ?? env.UNSPLASH_KEY
  const pexelsKey = env.REFKIT_PEXELS_KEY ?? env.PEXELS_KEY
  const pixabayKey = env.REFKIT_PIXABAY_KEY ?? env.PIXABAY_KEY
  const flickrKey = env.REFKIT_FLICKR_KEY ?? env.FLICKR_KEY
  const smithsonianKey = env.REFKIT_SMITHSONIAN_KEY ?? env.SI_KEY
  const braveKey = env.REFKIT_BRAVE_KEY ?? env.BRAVE_TOKEN
  const freesoundKey = env.REFKIT_FREESOUND_KEY ?? env.FREESOUND_TOKEN
  const jamendoClientId = env.REFKIT_JAMENDO_CLIENT_ID ?? env.JAMENDO_CLIENT_ID
  const europeanaKey = env.REFKIT_EUROPEANA_KEY ?? env.EUROPEANA_KEY
  if (unsplashKey) providers.push(unsplash({ accessKey: unsplashKey }))
  if (pexelsKey) providers.push(pexels({ apiKey: pexelsKey }), pexelsVideo({ apiKey: pexelsKey }))
  if (pixabayKey) providers.push(pixabay({ key: pixabayKey }), pixabayVideo({ key: pixabayKey }))
  if (flickrKey) providers.push(flickr({ apiKey: flickrKey }))
  if (smithsonianKey) providers.push(smithsonian({ apiKey: smithsonianKey }))
  if (braveKey) providers.push(brave({ token: braveKey }))
  if (freesoundKey) providers.push(freesound({ apiKey: freesoundKey }))
  if (jamendoClientId) providers.push(jamendo({ clientId: jamendoClientId }))
  if (europeanaKey) providers.push(europeana({ apiKey: europeanaKey }))
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

if (isEntry) {
  await serveStdio(createRefkit({ providers: defaultProviders() }))
}
