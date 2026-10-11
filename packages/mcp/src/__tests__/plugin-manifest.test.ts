import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The agent plugin (plugins/refkit) launches this package by exact version, so its
// manifests are checked here, next to the package they pin.
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const PLUGIN = join(ROOT, 'plugins/refkit')
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

const mcpVersion: string = readJson(join(ROOT, 'packages/mcp/package.json')).version
const mcpConfig = readJson(join(PLUGIN, '.mcp.json'))
const claudeManifest = readJson(join(PLUGIN, '.claude-plugin/plugin.json'))
const codexManifest = readJson(join(PLUGIN, '.codex-plugin/plugin.json'))
const claudeCatalog = readJson(join(ROOT, '.claude-plugin/marketplace.json'))
const codexCatalog = readJson(join(ROOT, '.agents/plugins/marketplace.json'))

// Files the plugin directory must not ship: a lockfile makes Claude Code run an
// install, and a registry config redirects npx. Both are directory blockers or holds.
// .DS_Store is left to .gitignore: Finder creates it locally and it is never committed.
const FORBIDDEN_FILES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock',
  'bun.lock', 'bun.lockb', '.npmrc', 'bunfig.toml', 'uv.toml',
])

function walk(dir: string): Array<{ path: string; name: string; symlink: boolean }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    const self = { path, name: entry.name, symlink: entry.isSymbolicLink() }
    return entry.isDirectory() ? [self, ...walk(path)] : [self]
  })
}

describe('agent plugin manifests', () => {
  it('launches @refkit/mcp pinned to exactly this package version, with no env', () => {
    // -y keeps npx from prompting on first run, which would hang a stdio launch.
    expect(mcpConfig).toEqual({
      mcpServers: { refkit: { command: 'npx', args: ['-y', `@refkit/mcp@${mcpVersion}`] } },
    })
  })

  it('pins an exact version, never a range or dist-tag', () => {
    expect(mcpConfig.mcpServers.refkit.args[1]).toMatch(/^@refkit\/mcp@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  })

  it('keeps both plugin manifests at the pinned version', () => {
    expect(claudeManifest.version).toBe(mcpVersion)
    expect(codexManifest.version).toBe(mcpVersion)
  })

  it('names the plugin and both marketplaces refkit, with one shared description', () => {
    expect(claudeCatalog.name).toBe('refkit')
    expect(codexCatalog.name).toBe('refkit')
    expect(claudeCatalog.plugins).toHaveLength(1)
    expect(codexCatalog.plugins).toHaveLength(1)
    for (const named of [claudeManifest, codexManifest, claudeCatalog.plugins[0], codexCatalog.plugins[0]]) {
      expect(named.name).toBe('refkit')
      expect(named.description).toBe(claudeManifest.description)
    }
  })

  it('points both catalogs at plugins/refkit', () => {
    expect(join(ROOT, claudeCatalog.plugins[0].source)).toBe(PLUGIN)
    expect(codexCatalog.plugins[0].source).toEqual({ source: 'local', path: './plugins/refkit' })
    expect(join(ROOT, codexCatalog.plugins[0].source.path)).toBe(PLUGIN)
  })

  it('declares the Codex MCP config path inside the plugin', () => {
    expect(codexManifest.mcpServers).toBe('./.mcp.json')
    expect(existsSync(join(PLUGIN, codexManifest.mcpServers))).toBe(true)
  })

  it('ships no package manifest, lockfile, registry config or symlink', () => {
    const entries = walk(PLUGIN)
    expect(entries.filter(e => e.symlink).map(e => e.path)).toEqual([])
    expect(entries.filter(e => FORBIDDEN_FILES.has(e.name)).map(e => e.path)).toEqual([])
  })
})
