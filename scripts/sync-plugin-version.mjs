#!/usr/bin/env node
// Pins the agent plugin (plugins/refkit) to the @refkit/mcp version this repo is
// releasing. Runs after `changeset version` (root `version-packages` script), so the
// "Version Packages" PR carries the new pin. The plugin launches the server with
// `npx -y @refkit/mcp@<exact>`: Anthropic's plugin directory refuses ranges, and the
// plugin's skills describe this exact tool surface.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = '@refkit/mcp'
const SERVER = 'refkit'
const PLUGIN_DIR = 'plugins/refkit'

/** Copy of a plugin manifest with `version` replaced (key order kept). */
export function withVersion(manifest, version) {
  return { ...manifest, version }
}

/** Copy of an `.mcp.json` config whose refkit server launches PACKAGE@version. */
export function withPinnedServer(config, version) {
  const server = config.mcpServers?.[SERVER]
  if (!server || !Array.isArray(server.args)) {
    throw new Error(`[sync-plugin-version] .mcp.json has no "${SERVER}" server with args`)
  }
  const at = server.args.findIndex(arg => arg === PACKAGE || arg.startsWith(`${PACKAGE}@`))
  if (at === -1) {
    throw new Error(`[sync-plugin-version] the "${SERVER}" server's args name no ${PACKAGE} package`)
  }
  const args = server.args.map((arg, i) => (i === at ? `${PACKAGE}@${version}` : arg))
  return { ...config, mcpServers: { ...config.mcpServers, [SERVER]: { ...server, args } } }
}

/** Rewrites the plugin files under `root` to packages/mcp's version. Returns that
 *  version and the files it actually changed. */
export function syncPluginVersion(root) {
  const { version } = JSON.parse(readFileSync(join(root, 'packages/mcp/package.json'), 'utf8'))
  const targets = [
    ['.mcp.json', config => withPinnedServer(config, version)],
    ['.claude-plugin/plugin.json', manifest => withVersion(manifest, version)],
    ['.codex-plugin/plugin.json', manifest => withVersion(manifest, version)],
  ]
  const changed = []
  for (const [rel, transform] of targets) {
    const file = join(root, PLUGIN_DIR, rel)
    const before = readFileSync(file, 'utf8')
    const after = `${JSON.stringify(transform(JSON.parse(before)), null, 2)}\n`
    if (after !== before) {
      writeFileSync(file, after)
      changed.push(file)
    }
  }
  return { version, changed }
}

// Run only when executed directly, not when imported by tests. realpath so a
// symlinked invocation still counts.
const isEntry = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isEntry) {
  const { version, changed } = syncPluginVersion(join(import.meta.dirname, '..'))
  console.log(changed.length
    ? `[sync-plugin-version] pinned ${PLUGIN_DIR} to ${PACKAGE}@${version} (${changed.length} file(s) updated)`
    : `[sync-plugin-version] ${PLUGIN_DIR} already pinned to ${PACKAGE}@${version}`)
}
