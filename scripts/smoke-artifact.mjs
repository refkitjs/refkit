#!/usr/bin/env node
// Artifact-level smoke test: verifies the bits we PUBLISH, not the source we test.
//
// Source-level suites (vitest) resolve workspace exports to src/*.ts, so nothing
// there can catch a broken dist — e.g. a bundler config change that inlines
// optionalDependencies (the exact regression this guards against). This script
// mirrors the real release path: `pnpm pack` every package (applies publishConfig
// exports→dist and rewrites workspace:* — same as `pnpm publish`), installs the
// tarballs into a clean temp project with npm, then boots the installed
// @refkit/mcp CLI through three scenarios:
//   1. keyless boot            → MCP initialize handshake answers
//   2. BYOK key set            → optional provider dynamically imports from node_modules
//   3. key set, package REMOVED → boots anyway with the graceful "not installed" warning
//
// Requires registry access for third-party deps (zod, MCP SDK). Run after `pnpm build`.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'refkit-smoke-'))
const tarballs = join(work, 'tarballs')
const app = join(work, 'app')

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts })

console.log('[smoke] packing workspace packages (publishConfig applied, like a real publish)…')
run('pnpm', ['-r', '--filter', './packages/*', 'exec', 'pnpm', 'pack', '--pack-destination', tarballs], { cwd: root })
const tgz = readdirSync(tarballs).filter(f => f.endsWith('.tgz'))
if (tgz.length < 20) throw new Error(`[smoke] expected ~21 tarballs, got ${tgz.length}`)

console.log(`[smoke] installing ${tgz.length} tarballs into a clean project…`)
run('mkdir', ['-p', app])
writeFileSync(join(app, 'package.json'), JSON.stringify({
  name: 'refkit-smoke-app',
  private: true,
  // every tarball is a direct file: dep, so @refkit/* inter-deps resolve to the
  // packed local versions instead of the (older) registry releases
  dependencies: Object.fromEntries(tgz.map(f => {
    const name = '@refkit/' + f.replace(/^refkit-/, '').replace(/-\d+\.\d+\.\d+\.tgz$/, '')
    return [name, `file:${join(tarballs, f)}`]
  })),
}, null, 2))
run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: app })

const cli = join(app, 'node_modules', '@refkit', 'mcp', 'dist', 'cli.js')
if (!existsSync(cli)) throw new Error('[smoke] installed @refkit/mcp has no dist/cli.js')

const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }) + '\n'

/** Boot the installed CLI, send initialize, capture first stdout line + stderr. */
function boot(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cli], { cwd: app, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`[smoke] boot timed out; stderr:\n${err}`)) }, 30_000)
    child.stdout.on('data', d => {
      out += d
      if (out.includes('\n')) { clearTimeout(timer); child.kill(); resolve({ out, err }) }
    })
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (!out.includes('\n')) { clearTimeout(timer); reject(new Error(`[smoke] exited (${code}) before responding; stderr:\n${err}`)) }
    })
    child.stdin.write(INIT)
  })
}

const assert = (cond, msg) => { if (!cond) throw new Error(`[smoke] FAIL: ${msg}`) }

console.log('[smoke] scenario 1: keyless boot answers the MCP initialize handshake…')
{
  const { out } = await boot({})
  const res = JSON.parse(out.slice(0, out.indexOf('\n')))
  assert(res.result?.serverInfo?.name === 'refkit', `unexpected initialize response: ${out.slice(0, 200)}`)
}

console.log('[smoke] scenario 2: BYOK key set — optional provider imports from node_modules…')
{
  const { out, err } = await boot({ REFKIT_UNSPLASH_KEY: 'dummy' })
  assert(out.includes('serverInfo'), 'no handshake with BYOK key set')
  assert(!err.includes('not installed'), `unexpected missing-package warning:\n${err}`)
}

console.log('[smoke] scenario 3: key set but package removed — graceful skip, not a crash…')
{
  rmSync(join(app, 'node_modules', '@refkit', 'provider-unsplash'), { recursive: true, force: true })
  const { out, err } = await boot({ REFKIT_UNSPLASH_KEY: 'dummy' })
  assert(out.includes('serverInfo'), 'server failed to boot with a missing optional provider')
  assert(err.includes('not installed'), `expected the graceful "not installed" warning, got:\n${err || '(empty)'}`)
}

rmSync(work, { recursive: true, force: true })
console.log('[smoke] PASS: published artifact boots, optional providers resolve at runtime and degrade gracefully')
