# Agent Plugin (Claude Code + Codex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `plugins/refkit/`, one plugin that bundles the `@refkit/mcp` server with two skills and installs from this repository's own marketplace, in both Claude Code and Codex.

**Architecture:** The plugin folder holds no code. It has two manifests (Claude, Codex), one shared `.mcp.json` that launches `npx -y @refkit/mcp@<exact>`, two `SKILL.md` files and a README. Two catalog files at the repo root make the repo a marketplace for each agent. A small Node script keeps the pinned version equal to `packages/mcp/package.json` at release time. Vitest tests in the `mcp` project pin that lockstep, the manifest consistency, and the skills' agreement with the live tool schemas.

**Tech Stack:** JSON manifests, Markdown skills, Node 22 ESM script (`.mjs`, no build), Vitest 3 (existing `mcp` project), changesets (existing release flow).

**Spec:** `docs/superpowers/specs/2026-10-11-agent-plugin-design.md`

## Global Constraints

- Plugin `name` is `refkit` in both manifests and both catalogs, and the marketplace `name` is `refkit` in both catalogs. Both are permanent.
- `plugins/refkit/.mcp.json` is exactly one server `refkit` → `{ "command": "npx", "args": ["-y", "@refkit/mcp@<exact version>"] }`. No `env`, no `${user_config.*}`.
- Plugin `version` (both manifests) == the `.mcp.json` pin == `packages/mcp/package.json` `version` (`0.8.2` at time of writing).
- One shared description string, verbatim, in both manifests and both catalog entries: `License-aware reference search for creative work: find images, art, textures, audio and text across open sources, with a use verdict and attribution line per result.`
- `plugins/refkit/` contains no `package.json`, lockfile, `.npmrc`/`bunfig.toml`/`uv.toml`, or symlink.
- No hooks, commands, agents or `userConfig` in the plugin.
- Skills are provider-neutral: they never mention Claude, Codex, Anthropic or OpenAI. They name tools as "refkit's `<tool>` tool".
- The three version-synced files (`.mcp.json`, both `plugin.json`) are kept in canonical `JSON.stringify(value, null, 2) + "\n"` form.
- No change to `@refkit/mcp` runtime code, so no changeset.

## Review Focus

1. A skill `description` containing `: ` or ` #` stops being valid YAML. The skill then fails to load in one agent and nothing reports it. Pinned in Task 3.
2. A `search_references` / `evaluate_use` / `build_attribution` parameter gets renamed in `@refkit/mcp`, and the skills keep teaching the old name. Pinned in Task 3: each parameter a skill relies on is checked against the live tool schema, and so are the intent and decision vocabularies.
3. Agent-specific wording (Claude/Codex/Anthropic/OpenAI) slips into a skill and breaks provider neutrality. Pinned in Task 3.
4. The sync script meets a look-alike argument such as `@refkit/mcp-extra@1.0.0`, or a config with no `@refkit/mcp` argument. It must refuse rather than pin the wrong package or silently pin nothing. Pinned in Task 2.
5. A hand-edited synced JSON file isn't in the script's output form, so the first release reformats it in an unrelated diff. Pinned in Task 2 (read-only canonical-form check of the real files).

---

## File Structure

| Path | Responsibility |
| :- | :- |
| `plugins/refkit/.mcp.json` | Launches the pinned MCP server; shared by both agents |
| `plugins/refkit/.claude-plugin/plugin.json` | Claude Code manifest (identity + version) |
| `plugins/refkit/.codex-plugin/plugin.json` | Codex manifest (identity + version + component paths + `interface`) |
| `plugins/refkit/skills/find-references/SKILL.md` | Judgement for searching: intent, annotate vs gate, query shaping, honest presentation |
| `plugins/refkit/skills/check-usage-rights/SKILL.md` | Judgement for one known work: license facts → verdict → credit line |
| `plugins/refkit/README.md` | User docs and directory listing text; discloses what runs and what it contacts |
| `.claude-plugin/marketplace.json` | Claude Code catalog |
| `.agents/plugins/marketplace.json` | Codex catalog |
| `scripts/sync-plugin-version.mjs` | Rewrites the pin + manifest versions from `packages/mcp/package.json` |
| `packages/mcp/src/__tests__/plugin-manifest.test.ts` | Manifest/catalog consistency, lockstep, skills vs tool schemas, README |
| `packages/mcp/src/__tests__/sync-plugin-version.test.ts` | The sync script's transforms and file rewriting |
| `package.json` (root) | `version-packages` runs the sync script after `changeset version` |
| `README.md` (root) | Install section + release runbook note |

The plugin tests live in the `mcp` vitest project because the plugin pins that package. CI's existing `pnpm test:run` picks them up with no workflow change.

---

### Task 1: Plugin manifests, shared MCP config and catalogs

**Files:**
- Create: `plugins/refkit/.mcp.json`
- Create: `plugins/refkit/.claude-plugin/plugin.json`
- Create: `plugins/refkit/.codex-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `.agents/plugins/marketplace.json`
- Test: `packages/mcp/src/__tests__/plugin-manifest.test.ts`

**Interfaces:**
- Consumes: `packages/mcp/package.json` `version`.
- Produces: the five JSON files above, which Tasks 2–5 rely on. In particular, Task 3 uses `codexManifest.skills === "./skills/"`. It also produces these module-level constants in `plugin-manifest.test.ts`, which Tasks 3 and 4 extend: `ROOT`, `PLUGIN`, `readJson(path: string)`, `mcpVersion`, `mcpConfig`, `claudeManifest`, `codexManifest`, `claudeCatalog`, `codexCatalog`.

- [ ] **Step 1: Write the failing test**

Create `packages/mcp/src/__tests__/plugin-manifest.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project mcp plugin-manifest`
Expected: FAIL. The suite errors at import with `ENOENT: no such file or directory, open '…/plugins/refkit/.mcp.json'`.

- [ ] **Step 3: Create the shared MCP config**

`plugins/refkit/.mcp.json` (canonical form: arrays expanded, trailing newline):

```json
{
  "mcpServers": {
    "refkit": {
      "command": "npx",
      "args": [
        "-y",
        "@refkit/mcp@0.8.2"
      ]
    }
  }
}
```

Before writing, check that `packages/mcp/package.json` still says `0.8.2`. If it says something else, use that version here and in Steps 4–5.

- [ ] **Step 4: Create the Claude manifest**

`plugins/refkit/.claude-plugin/plugin.json`:

```json
{
  "name": "refkit",
  "displayName": "refkit",
  "version": "0.8.2",
  "description": "License-aware reference search for creative work: find images, art, textures, audio and text across open sources, with a use verdict and attribution line per result.",
  "author": {
    "name": "refkitjs",
    "url": "https://github.com/refkitjs"
  },
  "homepage": "https://github.com/refkitjs/refkit/tree/main/plugins/refkit",
  "repository": "https://github.com/refkitjs/refkit",
  "license": "Apache-2.0",
  "keywords": [
    "references",
    "license",
    "attribution",
    "creative-commons",
    "public-domain",
    "moodboard"
  ]
}
```

- [ ] **Step 5: Create the Codex manifest**

`plugins/refkit/.codex-plugin/plugin.json`:

```json
{
  "name": "refkit",
  "version": "0.8.2",
  "description": "License-aware reference search for creative work: find images, art, textures, audio and text across open sources, with a use verdict and attribution line per result.",
  "author": {
    "name": "refkitjs",
    "url": "https://github.com/refkitjs"
  },
  "homepage": "https://github.com/refkitjs/refkit/tree/main/plugins/refkit",
  "repository": "https://github.com/refkitjs/refkit",
  "license": "Apache-2.0",
  "keywords": [
    "references",
    "license",
    "attribution",
    "creative-commons",
    "public-domain",
    "moodboard"
  ],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "refkit",
    "shortDescription": "License-aware reference search for creative work",
    "longDescription": "Search museums, Wikimedia Commons, Openverse, Poly Haven, Project Gutenberg and more for images, art, textures, audio and text. Every result carries its license, a verdict for your intended use, and the attribution line when one is required.",
    "developerName": "refkitjs",
    "category": "Productivity",
    "capabilities": [
      "Read"
    ],
    "defaultPrompt": [
      "Find CC0 forest textures I can ship in a game",
      "Gather public-domain storm paintings for a moodboard",
      "Can I use this Wikimedia Commons photo in an ad?"
    ],
    "websiteURL": "https://github.com/refkitjs/refkit",
    "brandColor": "#0F172A"
  }
}
```

- [ ] **Step 6: Create both catalogs**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "refkit",
  "description": "refkit's agent plugin: license-aware reference search with skills.",
  "owner": {
    "name": "refkitjs"
  },
  "plugins": [
    {
      "name": "refkit",
      "source": "./plugins/refkit",
      "description": "License-aware reference search for creative work: find images, art, textures, audio and text across open sources, with a use verdict and attribution line per result."
    }
  ]
}
```

`.agents/plugins/marketplace.json`:

```json
{
  "name": "refkit",
  "interface": {
    "displayName": "refkit"
  },
  "plugins": [
    {
      "name": "refkit",
      "description": "License-aware reference search for creative work: find images, art, textures, audio and text across open sources, with a use verdict and attribution line per result.",
      "source": {
        "source": "local",
        "path": "./plugins/refkit"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run --project mcp plugin-manifest`
Expected: PASS, 7 tests.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @refkit/mcp typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add plugins/refkit/.mcp.json plugins/refkit/.claude-plugin plugins/refkit/.codex-plugin .claude-plugin .agents packages/mcp/src/__tests__/plugin-manifest.test.ts
git commit -m "feat(plugin): refkit agent plugin manifests and marketplace catalogs"
```

---

### Task 2: Version sync script, wired into `version-packages`

**Files:**
- Create: `scripts/sync-plugin-version.mjs`
- Modify: `package.json` (root), `"version-packages"` script
- Test: `packages/mcp/src/__tests__/sync-plugin-version.test.ts`

**Interfaces:**
- Consumes: the three synced files from Task 1, and `packages/mcp/package.json`.
- Produces (exports of `scripts/sync-plugin-version.mjs`):
  - `withVersion(manifest: object, version: string): object`: copy with `version` replaced, key order kept
  - `withPinnedServer(config: { mcpServers: Record<string, { args: string[] }> }, version: string): object`: copy whose `refkit` server's `@refkit/mcp…` argument becomes `@refkit/mcp@<version>`. Throws if there is no `refkit` server with `args`, or no `@refkit/mcp` argument
  - `syncPluginVersion(root: string): { version: string; changed: string[] }`: rewrites the three files under `root` (absolute paths of the changed files are returned)
  - Running `node scripts/sync-plugin-version.mjs` syncs the real repo and prints one line. Importing the module does nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/mcp/src/__tests__/sync-plugin-version.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project mcp sync-plugin-version`
Expected: FAIL at import with `Cannot find module '…/scripts/sync-plugin-version.mjs'` (or `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Write the script**

Create `scripts/sync-plugin-version.mjs`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project mcp sync-plugin-version`
Expected: PASS, 8 tests (3 from `it.each` + 5).

- [ ] **Step 5: Wire it into the release flow**

In the root `package.json`, change:

```json
    "version-packages": "changeset version",
```

to:

```json
    "version-packages": "changeset version && node scripts/sync-plugin-version.mjs",
```

`release.yml` already runs `pnpm run version-packages` through `changesets/action`, which commits every file the version command changed into the "Version Packages" PR. No workflow edit.

- [ ] **Step 6: Check the CLI against the real repo**

Run: `node scripts/sync-plugin-version.mjs && git status --porcelain plugins/`
Expected: prints `[sync-plugin-version] plugins/refkit already pinned to @refkit/mcp@0.8.2`, and `git status` prints nothing (no files changed).

- [ ] **Step 7: Lint**

Run: `pnpm lint && pnpm --filter @refkit/mcp typecheck`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/sync-plugin-version.mjs packages/mcp/src/__tests__/sync-plugin-version.test.ts package.json
git commit -m "build(plugin): keep the plugin's @refkit/mcp pin in lockstep on version-packages"
```

---

### Task 3: The two skills, checked against the live tool schemas

**Files:**
- Create: `plugins/refkit/skills/find-references/SKILL.md`
- Create: `plugins/refkit/skills/check-usage-rights/SKILL.md`
- Modify: `packages/mcp/src/__tests__/plugin-manifest.test.ts` (append imports, helpers and a `describe` block)

**Interfaces:**
- Consumes: `PLUGIN`, `codexManifest` from Task 1's test module; `createRefkitMcpServer` from `packages/mcp/src/index.ts`; `INTENTS` and `createRefkit` from `@refkit/core`; `openverse` from `@refkit/provider-openverse`.
- Produces: the two `SKILL.md` files. Their front matter is exactly `name` + `description`.

- [ ] **Step 1: Write the failing tests**

Add to the import block at the top of `packages/mcp/src/__tests__/plugin-manifest.test.ts` (merge with the existing `node:path` import):

```ts
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRefkit, INTENTS } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { createRefkitMcpServer } from '../index'
```

Append to the end of the file:

```ts
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

async function listTools() {
  const refkit = createRefkit({ providers: [openverse()], fetch: (async () => new Response('{}')) as typeof fetch })
  const server = createRefkitMcpServer(refkit)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'plugin-manifest-test', version: '1.0.0' })
  await Promise.all([client.connect(clientT), server.connect(serverT)])
  const { tools } = await client.listTools()
  await client.close()
  return tools
}

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project mcp plugin-manifest`
Expected: Task 1's 7 tests PASS. The new `agent plugin skills` tests FAIL with `ENOENT … plugins/refkit/skills`.

- [ ] **Step 3: Write `find-references`**

Create `plugins/refkit/skills/find-references/SKILL.md`:

```markdown
---
name: find-references
description: Use when the user wants reference or source material (images, artworks, photos, textures, HDRIs, 3D models, video, music, sound effects, poems or public-domain books) for a moodboard or a project, and needs to know whether each result may be used for their purpose.
---

# Find references with refkit

refkit's `search_references` tool searches open collections (museums, Wikimedia Commons, Openverse, Poly Haven, Project Gutenberg and more). Every result comes back with a normalized license id and a link to its source page. This skill is about using the tool well, which means judging results by what the user will *do* with them.

## 1. Pin down the intended use

The same CC BY-NC image is fine on a private moodboard and off-limits in an ad. Before searching, map the user's purpose to an intent:

| The user will… | intent |
| :- | :- |
| collect it for private inspiration, a moodboard, an internal pitch | `internal-moodboard` |
| ship it in a product, game, app, ad, merch or marketing | `commercial-product` |
| feed it to an image, video or music generator, or a training set | `ai-generation-input` |
| republish or redistribute the file itself | `redistribution` |

If the purpose is unclear and would change which results are acceptable, ask one short question. If the user is only browsing, use `internal-moodboard`.

## 2. Annotate or filter

- Pass `intent` to label every result with a `useVerdict` and keep everything. Good for browsing, because the user sees what is usable and what is not.
- Pass `gateFor` (same values) to keep only `allowed` and `allowed-with-attribution` results for that use. Use it when the user needs results they can actually use, typically for `commercial-product` or `ai-generation-input`. It drops everything whose license is unknown, including all web-discovery results.

Pass one of the two on every search the user will act on. A bare license id with no verdict is easy to misread.

## 3. Shape the query

- Use short, concrete nouns and adjectives ("storm at sea oil painting", "mossy rock texture"), not full sentences.
- `modalities` defaults to images. Set it for other media: `["audio"]` for music and sound effects, `["text"]` for poems and books, `["video"]` for footage.
- The tool description lists the configured sources and what each covers. Use `sources` to target one when the ask is domain-specific, for example Poly Haven for HDRIs and textures. Naming a source also makes a narrow source answer queries it would otherwise decline. Nailbook (Japanese nail art) declines off-topic queries unless named, and works best with Japanese tag words.
- Add `minRelevance` (0.5 keeps only real matches) when the user wants only close matches. Leave it off for broad exploration, because it can empty a batch.
- `limit` sets how many results come back.

## 4. Present results honestly

For each result worth showing, give:

- the title and the source (`provider`)
- the license id
- the verdict (`useVerdict.decision`) and its reason, in plain words
- the `attribution` line when present (the user must reproduce it wherever the work appears)
- the `canonicalUrl` and, when useful, the `thumbnail`

Group or flag results by verdict:

- `allowed`: usable for that intent, as far as the license facts go.
- `allowed-with-attribution`: usable if credited with the given line.
- `needs-review`: the license is unknown or unclear, or the jurisdiction differs. Tell the user to check the source page before using it. Never present it as usable.
- `denied`: not for this use. Say so and offer alternatives.

A `useVerdict.confidence` of `low` deserves a "double-check the source" note.

## 5. More results and diagnostics

- When a result has `nextCursor`, repeat the same search with `cursor` set to it to get the next batch without repeats. No `nextCursor` means the search is exhausted.
- If results are empty or off-topic, retry with `explain` set to true. The returned `meta` shows which sources answered, failed, were skipped or declined, and which controls were ignored. Adjust the query, `modalities` or `sources` accordingly rather than repeating the same call.
- For a time-boxed request, `deadlineMs` bounds the whole call and returns whatever arrived in time.

## 6. Not legal advice

Verdicts are a conservative heuristic over license facts each source declares. They are not rights clearance. Say so once, briefly, when the user is about to rely on a result commercially. Never tell the user a work is "cleared" or "safe to use".

For a question about one specific work the user already has, use the `check-usage-rights` skill instead.
```

- [ ] **Step 4: Write `check-usage-rights`**

Create `plugins/refkit/skills/check-usage-rights/SKILL.md`:

```markdown
---
name: check-usage-rights
description: Use when the user has a specific work (a link, a license, an author) and asks whether they may use it for a purpose such as a product, an ad, AI generation or republishing, or how to credit it.
---

# Check usage rights with refkit

refkit's `evaluate_use` tool turns a work's license facts into a verdict for one intended use. refkit's `build_attribution` tool turns the same facts into the credit line the license asks for. Both are stateless: they judge only what you pass in, and fetch nothing.

## 1. Collect the license facts

| Argument | What to pass |
| :- | :- |
| `license` | One of the ids in the tool schema. Creative Commons licenses are family ids (`CC-BY`, `CC-BY-SA`, `CC-BY-NC`, …) with the version passed separately. Use `CC0-1.0` or `PD` for no rights reserved; `unsplash`, `pexels`, `pixabay` for those sites' own licenses; `proprietary` for all rights reserved; `unknown` when it can't be determined |
| `licenseVersion` | The Creative Commons version, such as `"4.0"`, when known. It only affects the credit line |
| `canonicalUrl` | The work's source page (required) |
| `author`, `title` | When known. They go into the credit line |
| `editorialOnly` | `true` when the source marks the work editorial-only |
| `jurisdiction`, `userJurisdiction` | The jurisdiction the source declares for a public-domain status, and where the user is, when known. A mismatch yields `needs-review` |

Do not guess the license. If the user hasn't given it:

- read it from the source page if you can open it, or
- if the work came from refkit's `search_references` tool, use that result's `license`.

If it still can't be determined, pass `unknown`. The verdict will be `needs-review`, which is the honest answer.

## 2. Map the use to an intent

Pass the user's purpose as `intent`:

| The user will… | intent |
| :- | :- |
| collect it for private inspiration, a moodboard, an internal pitch | `internal-moodboard` |
| ship it in a product, game, app, ad, merch or marketing | `commercial-product` |
| feed it to an image, video or music generator, or a training set | `ai-generation-input` |
| republish or redistribute the file itself | `redistribution` |

Ask one short question if the purpose is unclear. The answer often flips the verdict.

## 3. Call and report

Call `evaluate_use`, then report:

- the `decision` in plain words, with its `reasons`
- the `confidence`. On `low`, tell the user to double-check the source terms
- the `disclaimer`, once
- on `allowed-with-attribution`, the returned `attribution.text` (or `attribution.html` for a web page), and where it must appear: next to the work, or in the credits

When the user only needs the credit line, call `build_attribution` instead. If it returns `required: false` (for example for `CC0-1.0` or `PD`), say no credit is needed, and that crediting anyway is good practice.

## 4. When the answer is no

On `denied`, explain which license term blocks the use (the `reasons` say). On `needs-review`, say exactly what to verify at the source: the license itself, an editorial-only restriction, or the jurisdiction. In both cases, offer to find usable alternatives with `search_references` and `gateFor` set to the same intent (the `find-references` skill).

## Not legal advice

The verdict is a conservative heuristic over declared license facts, not rights clearance. Never tell the user a work is "cleared" or "safe to use".
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project mcp plugin-manifest`
Expected: PASS, 7 (Task 1) + 1 + 2 + 2 + 2 + 1 + 1 = 16 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @refkit/mcp typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add plugins/refkit/skills packages/mcp/src/__tests__/plugin-manifest.test.ts
git commit -m "feat(plugin): find-references and check-usage-rights skills, checked against the tool schemas"
```

---

### Task 4: Plugin README and root README

**Files:**
- Create: `plugins/refkit/README.md`
- Modify: `README.md` (root): the "Agent usage" list, a new "Agent plugin" section after "## MCP", and the "Develop" section
- Modify: `packages/mcp/src/__tests__/plugin-manifest.test.ts` (append one `describe` block)

**Interfaces:**
- Consumes: `PLUGIN` from Task 1's test module.
- Produces: `plugins/refkit/README.md`, the listing text for phase 2.

- [ ] **Step 1: Write the failing test**

Append to `packages/mcp/src/__tests__/plugin-manifest.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project mcp plugin-manifest`
Expected: the two README tests FAIL with `ENOENT … plugins/refkit/README.md`. The other 16 tests pass.

- [ ] **Step 3: Write the plugin README**

Create `plugins/refkit/README.md`:

````markdown
# refkit plugin

License-aware reference search for creative work, for Claude Code and Codex. Ask your agent for images, artworks, textures, HDRIs, 3D models, music, sound effects, poems or public-domain books. Every result comes back with its license, a verdict for what you plan to do with it (moodboard, commercial product, AI generation input, redistribution), the attribution line when one is required, and a link to the source.

## Install

Claude Code:

```bash
claude plugin marketplace add refkitjs/refkit
claude plugin install refkit@refkit
```

Codex: register the marketplace, then install **refkit** from the plugin browser in the Codex app.

```bash
codex plugin marketplace add refkitjs/refkit
```

## What's inside

- **MCP server** [`@refkit/mcp`](https://www.npmjs.com/package/@refkit/mcp) with three tools: `search_references`, `evaluate_use` and `build_attribution`.
- **Skills:** `find-references` (searching with a use verdict on every result) and `check-usage-rights` (judging one work you already have, and building its credit line).

## What it runs and contacts

- On first use, `npx` downloads `@refkit/mcp` from the npm registry, at the exact version pinned in `.mcp.json`, and runs it locally over stdio.
- Each search sends your query to the public APIs of the sources it searches: Openverse (images and audio), Wikimedia Commons, The Met, Art Institute of Chicago, Rijksmuseum, Poly Haven, ambientCG, Internet Archive, Project Gutenberg (through Gutendex), PoetryDB and Nailbook. Results link back to the source. Nothing is uploaded, stored or re-hosted.
- No API keys are needed, and the plugin configures none. The server also enables optional key-based sources if their `REFKIT_*_KEY` variables reach its environment; see the `@refkit/mcp` docs.

## Not legal advice

Verdicts are a conservative heuristic over the license facts each source declares. They are not rights clearance and not legal advice. Check the source page before relying on a result.

Apache-2.0 · [source and issues](https://github.com/refkitjs/refkit)
````

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project mcp plugin-manifest`
Expected: PASS, 18 tests.

- [ ] **Step 5: Update the root README**

In `README.md`, under `## Agent usage`, change the intro line `Agents can use refkit in two ways:` to `Agents can use refkit in three ways:` and append after item 2:

```markdown
3. **Agent plugin** — `plugins/refkit/` bundles the MCP server with skills that teach the agent when to search and how to read the verdicts, installable in Claude Code and Codex (see [Agent plugin](#agent-plugin-claude-code-codex)).
```

Insert this section between the end of `## MCP` and `## Not legal advice`:

````markdown
## Agent plugin (Claude Code, Codex)

[`plugins/refkit/`](plugins/refkit/README.md) packages `@refkit/mcp` with two skills: `find-references` (search with a use verdict on every result) and `check-usage-rights` (judge one work and build its credit line). This repository is its marketplace:

```bash
claude plugin marketplace add refkitjs/refkit
claude plugin install refkit@refkit
```

For Codex, run `codex plugin marketplace add refkitjs/refkit`, then install **refkit** from the plugin browser in the Codex app. The plugin uses the keyless sources and pins `@refkit/mcp` to an exact version.
````

At the end of `## Develop`, append:

```markdown
The agent plugin pins `@refkit/mcp` to an exact version. `pnpm run version-packages` (which the release workflow runs) rewrites that pin and the plugin's `version` through `scripts/sync-plugin-version.mjs`, so the "Version Packages" PR carries them. If the npm publish then fails, the plugin points at an unpublished version until the release is re-run (`gh run rerun <id> --failed`).
```

- [ ] **Step 6: Check the README anchor**

Run: `grep -n "agent-plugin-claude-code-codex\|^## Agent plugin" README.md`
Expected: one link line and one heading line. GitHub turns `## Agent plugin (Claude Code, Codex)` into the anchor `agent-plugin-claude-code-codex`.

- [ ] **Step 7: Commit**

```bash
git add plugins/refkit/README.md README.md packages/mcp/src/__tests__/plugin-manifest.test.ts
git commit -m "docs(plugin): plugin README with disclosure, root README install section and release note"
```

---

### Task 5: Verify in real agents, settle the Codex install wording, open the PR

**Files:**
- Modify (only if Step 7 requires it): `plugins/refkit/README.md`, `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a verified branch and a PR.

- [ ] **Step 1: Full local CI equivalent**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:run`
Expected: all exit 0. The mcp project includes the 18 plugin-manifest and 8 sync-plugin-version tests.

- [ ] **Step 2: Validate the plugin and the catalog with Claude Code**

Run: `claude plugin validate --strict plugins/refkit && claude plugin validate .`
Expected: each ends with `✔ Validation passed`. The local CLI is 2.1.232. MCP-entry checks need 2.1.281 or later, and an older CLI may warn `Unknown field` on newer manifest keys. If `--strict` fails only on an unknown-field warning for a documented key (for example `displayName`), report it and ask the user before updating Claude Code. Don't delete the field.

- [ ] **Step 3: Headless smoke test in Claude Code**

Run (the prompt comes right after `-p`; `--allowedTools` takes one comma-separated value so it can't swallow the prompt):

```bash
OUT=$(mktemp -t refkit-plugin-smoke)
claude -p "Find CC0 or public-domain forest textures I can ship in a commercial game." \
  --plugin-dir plugins/refkit --output-format stream-json --verbose \
  --allowedTools "Skill,mcp__plugin_refkit_refkit__search_references" > "$OUT"
grep -c 'search_references' "$OUT"
grep -o '"gateFor":"[^"]*"\|"intent":"[^"]*"' "$OUT" | sort | uniq -c
```

Expected: the first count is non-zero, and the second prints `"gateFor":"commercial-product"` (or `"intent":"commercial-product"`). If the tool name differs, list the tools with `claude -p --plugin-dir plugins/refkit "/mcp"` and adjust `--allowedTools`. If no `search_references` call appears, read the full stream for the failure (server start, permission, skill not triggering) before changing anything.

- [ ] **Step 4: Marketplace install round trip in Claude Code**

Run:

```bash
claude plugin marketplace add ./
claude plugin install refkit@refkit
claude plugin details refkit
```

Expected: the install succeeds. `details` (on a CLI without it, `claude plugin list`) lists 2 skills (`find-references`, `check-usage-rights`) and 1 MCP server (`refkit`).

Then clean up so the user's settings are unchanged:

```bash
claude plugin marketplace remove refkit
```

Expected: `✔ Successfully removed marketplace: refkit`.

- [ ] **Step 5: Codex check (the user runs it)**

The Codex CLI isn't on this machine's PATH. Ask the user to do the following in the Codex app:

1. Add this worktree as a local marketplace: `codex plugin marketplace add /Users/xuan/Desktop/testSpace/refkit/.claude/worktrees/architecture-design-review-581001` from a terminal where the Codex CLI is available, or the app's equivalent.
2. Install **refkit**. Note exactly where and how: app plugin browser, a CLI command, or both.
3. To reproduce a first launch, clear the npx cache first (`rm -rf ~/.npm/_npx`). Then ask "Find CC0 forest textures I can ship in a commercial game." and note whether the refkit server starts within Codex's 10 s startup timeout.
4. Report: the install path, whether `search_references` was called, and whether a timeout occurred.

- [ ] **Step 6: Act on the Codex result**

- If the server timed out on the first launch: check whether Codex accepts `startup_timeout_sec` in a plugin `.mcp.json` entry. If it does, and `claude plugin validate --strict plugins/refkit` still passes with the key added, add `"startup_timeout_sec": 60` to the `refkit` server. Then update Task 1's exact-shape test (`launches @refkit/mcp pinned…`) to include it, and confirm `withPinnedServer` keeps it (spread preserves it). Otherwise add one line to the plugin README's Codex install paragraph: `The first launch downloads the server and can exceed Codex's 10-second startup timeout; if refkit fails to start once, retry.`
- If the observed Codex install step differs from "install **refkit** from the plugin browser in the Codex app", rewrite that sentence in `plugins/refkit/README.md` and in the root README's Agent plugin section to match what the user saw.

Then run `pnpm vitest run --project mcp plugin-manifest sync-plugin-version` and expect PASS. If anything changed, commit:

```bash
git add plugins/refkit README.md packages/mcp/src/__tests__/plugin-manifest.test.ts
git commit -m "docs(plugin): Codex install and first-launch notes from manual testing"
```

- [ ] **Step 7: Sync with upstream and open the PR**

```bash
git fetch upstream main
git rev-list --left-right --count HEAD...upstream/main
```

If upstream moved, merge `upstream/main` (run the sync tool when in an app-made worktree), re-run `node scripts/sync-plugin-version.mjs` (a Version Packages merge may have bumped `@refkit/mcp`), commit any pin change, and re-run Step 1.

With the user's go-ahead, push and open the PR against `main`. Title: `feat: refkit agent plugin for Claude Code and Codex`. The body must cover what ships, the manual verification results from Steps 3–5, and the phase 2 directory submission as follow-up. The user merges it.
