import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRefkit, INTENTS, LICENSE_IDS } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { createRefkitMcpServer } from '../index'
import { BYOK_SOURCES, defaultProviders } from '../cli'

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

const SKILLS = join(PLUGIN, 'skills')
const SKILL_NAMES = ['check-usage-rights', 'find-references']
const skillText = (name: string) => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')

// Parameters each skill teaches, per tool. Checked against the live tool schema so a
// renamed parameter fails here instead of leaving the skill teaching a dead name.
const SKILL_TOOL_PARAMS: Record<string, Record<string, string[]>> = {
  'find-references': {
    search_references: ['intent', 'gateFor', 'modalities', 'sources', 'minRelevance', 'limit', 'cursor', 'explain', 'deadlineMs'],
  },
  'check-usage-rights': {
    evaluate_use: ['license', 'licenseVersion', 'canonicalUrl', 'author', 'title', 'editorialOnly', 'jurisdiction', 'userJurisdiction', 'intent'],
    build_attribution: ['license', 'licenseVersion', 'canonicalUrl', 'author', 'title'],
  },
}

/** `key: value` lines between the leading `---` fences. A folded or multi-line value
 *  shows up as extra keys, which the tests reject. */
function frontMatter(markdown: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown)
  if (!match) throw new Error('SKILL.md has no front matter')
  return Object.fromEntries(match[1].split('\n').map(line => {
    const colon = line.indexOf(':')
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]
  }))
}

async function withClient<T>(use: (client: Client) => Promise<T>): Promise<T> {
  const refkit = createRefkit({ providers: [openverse()], fetch: (async () => new Response('{}')) as typeof fetch })
  const server = createRefkitMcpServer(refkit)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'plugin-manifest-test', version: '1.0.0' })
  await Promise.all([client.connect(clientT), server.connect(serverT)])
  try {
    return await use(client)
  } finally {
    await client.close()
  }
}

const listTools = () => withClient(async client => (await client.listTools()).tools)
const callTool = (name: string, args: Record<string, unknown>) =>
  withClient(async client => (await client.callTool({ name, arguments: args })).structuredContent as Record<string, unknown>)

describe('agent plugin skills', () => {
  it('ships exactly the two skills, where the Codex manifest looks for them', () => {
    expect(resolve(PLUGIN, codexManifest.skills)).toBe(SKILLS)
    const dirs = readdirSync(SKILLS, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    expect(dirs.sort()).toEqual(SKILL_NAMES)
  })

  it.each(SKILL_NAMES)('%s has name + a one-line, YAML-safe description', name => {
    const fm = frontMatter(skillText(name))
    expect(Object.keys(fm)).toEqual(['name', 'description'])
    expect(fm.name).toBe(name)
    expect(fm.description.length).toBeGreaterThan(20)
    expect(fm.description.length).toBeLessThanOrEqual(1024)
    // An unquoted YAML scalar breaks on ": " or " #", and on a leading indicator.
    expect(fm.description).not.toMatch(/: | #/)
    expect(fm.description).not.toMatch(/^[|>[{&*!%@`'"-]/)
  })

  it.each(SKILL_NAMES)('%s stays provider-neutral', name => {
    expect(skillText(name)).not.toMatch(/claude|codex|anthropic|openai/i)
  })

  it.each(SKILL_NAMES)('%s names every intent the tools accept', name => {
    for (const intent of INTENTS) expect(skillText(name)).toContain(`\`${intent}\``)
  })

  it('teaches only tool parameters that exist, and names each tool it relies on', async () => {
    const tools = await listTools()
    for (const [skill, byTool] of Object.entries(SKILL_TOOL_PARAMS)) {
      const text = skillText(skill)
      for (const [toolName, params] of Object.entries(byTool)) {
        const tool = tools.find(t => t.name === toolName)
        expect(tool, `${skill} relies on missing tool ${toolName}`).toBeDefined()
        expect(text).toContain(`\`${toolName}\``)
        const accepted = Object.keys(tool!.inputSchema.properties ?? {})
        for (const param of params) {
          expect(accepted, `${toolName} no longer accepts ${param} (${skill})`).toContain(param)
          expect(text, `${skill} should mention \`${param}\``).toContain(`\`${param}\``)
        }
      }
    }
  })

  it('find-references explains every verdict decision the tools return', async () => {
    const evaluate = (await listTools()).find(t => t.name === 'evaluate_use')!
    const decisions = (evaluate.outputSchema!.properties!.decision as { enum: string[] }).enum
    expect(decisions.length).toBeGreaterThan(0)
    for (const decision of decisions) expect(skillText('find-references')).toContain(`\`${decision}\``)
  })
})

describe('agent plugin README', () => {
  const readme = () => readFileSync(join(PLUGIN, 'README.md'), 'utf8')
  // The directory refuses a README under 40 words, not counting code blocks.
  const proseWords = (markdown: string) => markdown.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length

  it('has at least 40 words of prose', () => {
    expect(proseWords(readme())).toBeGreaterThanOrEqual(40)
  })

  it('discloses what it runs and contacts, and asks for no credentials', () => {
    const text = readme()
    expect(text).toContain('@refkit/mcp')
    expect(text).toMatch(/npm registry/)
    expect(text).toMatch(/not legal advice/i)
    // The directory holds plugins that tell users to export credentials.
    expect(text).not.toMatch(/export\s+[A-Z_]*KEY/)
  })
})

/** The first line of `text` that starts with `prefix` ('' when none does). */
const lineStartingWith = (text: string, prefix: string) => text.split('\n').find(l => l.startsWith(prefix)) ?? ''
const licenseIdsIn = (line: string) =>
  [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(t => (LICENSE_IDS as readonly string[]).includes(t))

// The skills and README describe what the shipped server does; these tests ask the
// server rather than restating its behavior, so a change in core shows up here.
describe('agent plugin text matches what the server does', () => {
  const canonicalUrl = 'https://example.org/work'

  it('check-usage-rights says which licenses need no credit, and which only lack a credit line', async () => {
    const creditFree: string[] = []
    const noCreditLine: string[] = []
    for (const license of LICENSE_IDS) {
      if ((await callTool('build_attribution', { license, canonicalUrl })).required) continue
      const verdict = await callTool('evaluate_use', { license, canonicalUrl, intent: 'commercial-product' })
      ;(verdict.decision === 'allowed' ? creditFree : noCreditLine).push(license)
    }
    expect(noCreditLine.length).toBeGreaterThan(0)
    const text = skillText('check-usage-rights')
    expect(licenseIdsIn(lineStartingWith(text, '`required: false` means no credit is needed only for')).sort()).toEqual(creditFree.sort())
    expect(licenseIdsIn(lineStartingWith(text, '`required: false` for ')).sort()).toEqual(noCreditLine.sort())
  })

  it('check-usage-rights files editorial-only under denied, and names the real needs-review causes', async () => {
    const editorial = await callTool('evaluate_use', { license: 'CC0-1.0', canonicalUrl, intent: 'commercial-product', editorialOnly: true })
    expect(editorial.decision).toBe('denied')
    const ncRedistribution = await callTool('evaluate_use', { license: 'CC-BY-NC', canonicalUrl, intent: 'redistribution' })
    expect(ncRedistribution.decision).toBe('needs-review')
    const text = skillText('check-usage-rights')
    expect(lineStartingWith(text, 'On `denied`')).toMatch(/editorial-only/)
    const needsReview = lineStartingWith(text, 'On `needs-review`')
    expect(needsReview).not.toMatch(/editorial/)
    expect(needsReview).toMatch(/jurisdiction/)
    expect(needsReview).toMatch(/NonCommercial/)
  })

  it('promises only resource kinds the keyless server can return', async () => {
    const kinds = new Set((await defaultProviders({})).flatMap(p => p.kinds ?? []))
    const texts: Record<string, string> = {
      ...Object.fromEntries(SKILL_NAMES.map(name => [name, skillText(name)])),
      'README.md': readFileSync(join(PLUGIN, 'README.md'), 'utf8'),
      'codex interface': JSON.stringify(codexManifest.interface),
    }
    for (const [kind, pattern] of [['hdri', /hdri/i], ['3d-model', /3d model/i]] as const) {
      if (kinds.has(kind)) continue
      for (const [where, text] of Object.entries(texts)) expect(text, `${where} promises ${kind}`).not.toMatch(pattern)
    }
  })

  it.each(SKILL_NAMES)('%s scopes its trigger away from software and code', name => {
    expect(frontMatter(skillText(name)).description).toMatch(/not for (software|code)/i)
  })

  it('README names every key variable the server reads', () => {
    const names = BYOK_SOURCES.flatMap(source => {
      const read: string[] = []
      source.key(new Proxy({}, { get: (_, prop) => { read.push(String(prop)); return undefined } }) as NodeJS.ProcessEnv)
      return read
    })
    expect(names.length).toBeGreaterThanOrEqual(BYOK_SOURCES.length * 2)
    const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8')
    for (const name of names) expect(readme, `README should name ${name}`).toContain(`\`${name}\``)
  })
})

// Anthropic's directory reads these from .claude-plugin/plugin.json for the listing
// (Claude Code itself ignores them); the Codex app shows the same artwork.
describe('directory listing fields', () => {
  const pngSize = (path: string) => {
    const bytes = readFileSync(path)
    expect(bytes.subarray(0, 8).toString('hex'), `${path} is not a PNG`).toBe('89504e470d0a1a0a')
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }

  it('points icon at a square PNG of at least 512px inside the plugin', () => {
    expect(claudeManifest.icon).toBe('./assets/icon.png')
    const { width, height } = pngSize(join(PLUGIN, claudeManifest.icon))
    expect(width).toBe(height)
    expect(width).toBeGreaterThanOrEqual(512)
  })

  it('links a privacy policy that the plugin README actually contains', () => {
    expect(claudeManifest.privacyPolicyUrl).toBe('https://github.com/refkitjs/refkit/blob/main/plugins/refkit/README.md#privacy')
    expect(readFileSync(join(PLUGIN, 'README.md'), 'utf8')).toMatch(/^## Privacy$/m)
  })

  it('links documentation and support over https', () => {
    expect(claudeManifest.documentationUrl).toBe('https://github.com/refkitjs/refkit/tree/main/plugins/refkit#readme')
    expect(claudeManifest.supportUrl).toBe('https://github.com/refkitjs/refkit/issues')
  })

  it('gives the Codex app the same artwork', () => {
    expect(codexManifest.interface.logo).toBe(claudeManifest.icon)
    expect(codexManifest.interface.composerIcon).toBe('./assets/icon.svg')
    expect(existsSync(join(PLUGIN, codexManifest.interface.composerIcon))).toBe(true)
  })
})

// Anthropic's directory blocks a plugin whose npx launcher could be steered by a
// package-manager config in the plugin or in any folder above it ("Package registry
// redirected"), and it counts every pnpm setting in pnpm-workspace.yaml, not only
// registry keys.
describe('package-manager config above the plugin', () => {
  it('pnpm-workspace.yaml declares only the workspace packages', () => {
    const text = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
    const keys = text.split('\n').filter(line => /^[A-Za-z]/.test(line)).map(line => line.slice(0, line.indexOf(':')))
    expect(keys).toEqual(['packages'])
  })

  it('has no .npmrc, bunfig.toml or uv.toml between the repository root and the plugin', () => {
    for (const dir of [ROOT, join(ROOT, 'plugins')]) {
      for (const name of ['.npmrc', 'bunfig.toml', 'uv.toml']) expect(existsSync(join(dir, name)), join(dir, name)).toBe(false)
    }
  })
})
