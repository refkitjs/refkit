import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type McpConfig = { mcpServers: Record<string, { command: string; args: string[] }> }
interface SyncModule {
  withVersion: (manifest: Record<string, unknown>, version: string) => Record<string, unknown>
  withPinnedServer: (config: McpConfig, version: string) => McpConfig
  syncPluginVersion: (root: string) => { version: string; changed: string[] }
}

// A plain .mjs script (run by `pnpm version-packages` with no build step), so it is
// imported dynamically and typed here. Importing it must not touch the repo.
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCRIPT = new URL('../../../../scripts/sync-plugin-version.mjs', import.meta.url)
const { withVersion, withPinnedServer, syncPluginVersion } = (await import(SCRIPT.href)) as SyncModule

const config = (args: string[]): McpConfig => ({ mcpServers: { refkit: { command: 'npx', args } } })

function fixtureRepo(packageVersion: string, pin: string, manifestVersion: string): string {
  const root = mkdtempSync(join(tmpdir(), 'refkit-plugin-sync-'))
  const write = (rel: string, data: unknown) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), `${JSON.stringify(data, null, 2)}\n`)
  }
  write('packages/mcp/package.json', { name: '@refkit/mcp', version: packageVersion })
  write('plugins/refkit/.mcp.json', config(['-y', pin]))
  write('plugins/refkit/.claude-plugin/plugin.json', { name: 'refkit', version: manifestVersion, description: 'd' })
  write('plugins/refkit/.codex-plugin/plugin.json', { name: 'refkit', version: manifestVersion, skills: './skills/' })
  return root
}

describe('sync-plugin-version', () => {
  it.each(['@refkit/mcp', '@refkit/mcp@0.1.0', '@refkit/mcp@latest'])('pins %s to the exact version, keeping other args', pin => {
    expect(withPinnedServer(config(['-y', pin]), '0.9.0').mcpServers.refkit.args).toEqual(['-y', '@refkit/mcp@0.9.0'])
  })

  it('refuses a look-alike package instead of pinning it or pinning nothing', () => {
    expect(() => withPinnedServer(config(['-y', '@refkit/mcp-extra@1.0.0']), '0.9.0')).toThrow(/@refkit\/mcp/)
  })

  it('refuses a config without a refkit server', () => {
    expect(() => withPinnedServer({ mcpServers: {} }, '0.9.0')).toThrow(/refkit/)
  })

  it('rewrites the manifest version in place, keeping key order', () => {
    const out = withVersion({ name: 'refkit', version: '0.1.0', description: 'd' }, '0.9.0')
    expect(Object.keys(out)).toEqual(['name', 'version', 'description'])
    expect(out.version).toBe('0.9.0')
  })

  it('rewrites the pin and both manifest versions in canonical form, then is a no-op', () => {
    const root = fixtureRepo('0.9.0', '@refkit/mcp@0.8.2', '0.8.2')
    try {
      const first = syncPluginVersion(root)
      expect(first.version).toBe('0.9.0')
      expect(first.changed).toHaveLength(3)
      const text = (rel: string) => readFileSync(join(root, 'plugins/refkit', rel), 'utf8')
      expect(JSON.parse(text('.mcp.json')).mcpServers.refkit.args).toEqual(['-y', '@refkit/mcp@0.9.0'])
      expect(JSON.parse(text('.claude-plugin/plugin.json')).version).toBe('0.9.0')
      expect(JSON.parse(text('.codex-plugin/plugin.json')).version).toBe('0.9.0')
      for (const rel of ['.mcp.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
        expect(text(rel)).toBe(`${JSON.stringify(JSON.parse(text(rel)), null, 2)}\n`)
      }
      expect(syncPluginVersion(root).changed).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds the real plugin files already in the form the script writes', () => {
    // Read-only: a hand-edited file in another layout would be reformatted by the
    // next release's Version Packages PR, burying the version bump in noise.
    for (const rel of ['.mcp.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
      const text = readFileSync(join(ROOT, 'plugins/refkit', rel), 'utf8')
      expect(text, rel).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`)
    }
  })
})
