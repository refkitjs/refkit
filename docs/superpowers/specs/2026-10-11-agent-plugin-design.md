# Agent Plugin (Claude Code + Codex) Design

## Goal

Ship refkit as one installable agent plugin that works in both Claude Code and OpenAI
Codex. The plugin bundles the existing `@refkit/mcp` server (the tools) with skills that
teach the agent *when* to reach for refkit and *how* to use its license verdicts well.
A user should go from nothing to "find me CC0 forest textures I can ship in a game" in
two commands, on either agent.

## Scope

- **Plugin folder** `plugins/refkit/` inside this monorepo: Claude and Codex manifests,
  one shared `.mcp.json`, two skills, a README.
- **Self-hosted marketplace** at the repository root, one catalog file per agent, so
  both agents install straight from `refkitjs/refkit`.
- **Version lockstep**: the plugin pins an exact `@refkit/mcp` version, kept equal to
  `packages/mcp/package.json` by a sync script in `version-packages` and a test in CI.
- **Docs**: plugin README (also the directory listing text) and an install section in
  the root README.
- **Phase 2 (after v1 ships, manual):** submit the same folder to Anthropic's plugin
  directory.

Non-goals:

- OpenAI's public plugin directory. It accepts only remote HTTPS MCP servers or
  skills-only bundles; `npx`-launched stdio servers are refused. Getting there means
  hosting refkit as a remote Streamable HTTP service, which is a separate project.
- BYOK keys through the plugin (`userConfig`). See [BYOK](#byok-keys-deferred).
- Hooks, commands, agents, or any Claude-only component. Hooks also disqualify a plugin
  from OpenAI's directory, and commands/agents would need converting to skills for
  Codex anyway.
- A listing in `claude-plugins-official`. Anthropic only takes that through partner
  contacts. The public route is the directory (phase 2).
- Any change to `@refkit/mcp` runtime behavior.

## Layout

```text
.claude-plugin/
  marketplace.json            # Claude Code catalog (repo root = marketplace root)
.agents/plugins/
  marketplace.json            # Codex catalog
plugins/refkit/
  .claude-plugin/plugin.json  # Claude manifest
  .codex-plugin/plugin.json   # Codex manifest
  .mcp.json                   # shared MCP server config
  skills/
    find-references/SKILL.md
    check-usage-rights/SKILL.md
  README.md
scripts/
  sync-plugin-version.mjs     # rewrites the pin after `changeset version`
packages/mcp/src/__tests__/
  plugin-manifest.test.ts     # lockstep + consistency checks
```

`plugins/` is outside `pnpm-workspace.yaml` (`packages/*`), so pnpm, changesets, tsc and
eslint never see it. The plugin has no `package.json` and no lockfile. A lockfile in
the plugin folder would make Claude Code run an install, and the directory holds that
for review.

Why this monorepo and not a separate repo (as with `dsh-plugin`): the skills describe
`search_references` parameters, and those change in the same PRs as the tool. #27 added
`minRelevance`, `deadlineMs` and `gateContext`, for example. `dsh-plugin` lives apart
because it tracks dsh's prerelease plugin API. refkit's plugin only tracks refkit.

## Names

| Thing | Value | Notes |
| :- | :- | :- |
| Plugin `name` (both manifests, both catalogs) | `refkit` | Permanent; renames break installs. Not reserved, not a brand clash |
| Marketplace `name` (both catalogs) | `refkit` | Install id `refkit@refkit` |
| MCP server key in `.mcp.json` | `refkit` | Claude Code exposes tools as `mcp__plugin_refkit_refkit__*` |
| Skills | `find-references`, `check-usage-rights` | Namespaced `refkit:<skill>` in Claude Code |

## Manifests

### `plugins/refkit/.mcp.json` (shared)

```json
{
  "mcpServers": {
    "refkit": { "command": "npx", "args": ["-y", "@refkit/mcp@0.8.2"] }
  }
}
```

- **Exact version pin, required.** Anthropic's directory validation blocks an `npx`
  package given as a range or `@latest`. Even a pinned one gets a reviewer hold, because
  the package's own dependencies resolve at install time. That is expected, not a defect.
- **No `env` and no `${user_config.*}`.** The same file is read by Codex, which doesn't
  substitute `${user_config.*}` and would pass the literal string through as a key.
- `-y` stops `npx` from prompting on first run. Without it, a stdio launch hangs.

### `plugins/refkit/.claude-plugin/plugin.json`

`name`, `displayName` ("refkit"), `version` (= pin), `description`, `author`
(`{ "name": "refkitjs" }`), `homepage` (the plugin folder on GitHub), `repository`,
`license: "Apache-2.0"`, `keywords`. Leave out the component path keys: the default
`skills/` scan and root `.mcp.json` pick everything up. Directory listing fields
(`icon` and friends) wait for phase 2.

### `plugins/refkit/.codex-plugin/plugin.json`

Same identity fields, plus the Codex-specific keys from the shape OpenAI's own bundled
plugins use:

- `"skills": "./skills/"` and `"mcpServers": "./.mcp.json"`
- `interface`: `displayName`, `shortDescription`, `longDescription`, `developerName`,
  `category`, `capabilities: ["Read"]`, `defaultPrompt` (2–3 example asks),
  `websiteURL`, `brandColor`

OpenAI documents a newer "portable" root `plugin.json` with `extensions.com.openai`, and
says `.codex-plugin/plugin.json` is the fallback. We use the fallback: it is the shape
already proven on both agents (superpowers ships it), and it keeps the plugin root free
of a second root-level manifest that Claude Code would ignore.

### Catalogs

One description string is shared by both manifests and both catalogs:

> License-aware reference search for creative work: find images, art, textures, audio
> and text across open sources, with a use verdict and attribution line per result.

`.claude-plugin/marketplace.json`: `name: "refkit"`, `owner: { "name": "refkitjs" }`,
one entry `{ "name": "refkit", "source": "./plugins/refkit", "description": <shared> }`.

`.agents/plugins/marketplace.json`: `name: "refkit"`, `interface.displayName: "refkit"`,
one entry `{ "name": "refkit", "source": { "source": "local", "path": "./plugins/refkit" },
"policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
"category": "Productivity" }`. The Codex manifest's `interface.category` uses the same
value.

User-facing install:

```bash
# Claude Code
claude plugin marketplace add refkitjs/refkit
claude plugin install refkit@refkit

# Codex: the CLI registers the catalog; the plugin is then installed from the
# Codex desktop app's plugin browser
codex plugin marketplace add refkitjs/refkit
```

The exact Codex install step (app-only, or also a CLI command) is confirmed during
manual testing and written into the README as observed.

## Skills

Both skills use provider-neutral wording. They say "refkit's `search_references` tool",
never Claude- or Codex-specific names, so the same text works in both agents and in a
future OpenAI skills submission. The front matter is just `name` plus a one-line
`description` naming the trigger situations. Each body stays under ~150 lines. The
tool's own schema already documents every parameter, so the skills cover judgement
only, not the parameter list.

### `find-references`

Triggers: the user wants reference or source material. That means images, artworks,
photos, textures, HDRIs, 3D models, video, music, sound effects, poems, public-domain
books, moodboards, or "something I can use for X".

Content:

1. **Pin down the intended use first**, because it decides how results are judged. Map
   it to an intent:
   - moodboard or private inspiration → `internal-moodboard`
   - shipped in a product or marketing → `commercial-product`
   - fed into image/model generation → `ai-generation-input`
   - republishing the file itself → `redistribution`

   Ask once if the use is unclear and the answer would change the outcome.
2. **Annotate vs filter.** Pass `intent` to label every result. Pass `gateFor` when the
   user needs only usable results (typically `commercial-product`). With `gateFor`,
   `needs-review` results are dropped, and so is everything from discovery sources.
3. **Shape the query.** Use short concrete nouns. Set `modalities` for non-image asks.
   Use `sources` for a domain source. Nailbook wants Japanese tag words, and naming it
   bypasses its decline. Use `minRelevance: 0.5` when precision beats recall.
4. **Present results honestly.** Show title, source, license, the verdict and its
   reason, the attribution line when required, and the canonical link. Group or flag
   by verdict. `needs-review` and `unknown` mean "verify at the source", never "fine".
5. **More and diagnostics.** Use `nextCursor` for the next batch. If results are empty
   or odd, retry with `explain: true` and read which sources failed, were skipped, or
   declined.
6. **Never claim rights clearance.** Say once, plainly, that verdicts are heuristics,
   not legal advice.

### `check-usage-rights`

Triggers: the user has a specific work (a URL, a license, an author) and asks whether
they may use it for something, or how to credit it.

Content:

1. Get the license facts. Use the license id and version, canonical URL, author and
   title. If the license isn't known, don't guess: read it from the source page or
   from a `search_references` result.
2. Call `evaluate_use` with the matching intent. Add `jurisdiction` /
   `userJurisdiction` when the user's location matters.
3. Report `decision`, `reasons`, `confidence` and the `disclaimer`. When attribution is
   required, give the ready `attribution` text (or HTML for web use).
4. Use `build_attribution` when the user only needs a credit line.
5. On `denied` or `needs-review`, say what to verify and offer to find alternatives
   (hand off to `find-references` with `gateFor`).

## Version lockstep

The plugin `version` in both manifests and the `.mcp.json` pin always equal
`packages/mcp/package.json`'s version.

- `scripts/sync-plugin-version.mjs` reads that version and rewrites the three
  occurrences. It edits JSON by parsing and re-serializing with 2-space indent and a
  trailing newline, never with regex.
- Root `package.json`: `"version-packages": "changeset version && node scripts/sync-plugin-version.mjs"`.
  `release.yml` already runs `pnpm run version-packages`, so the changesets "Version
  Packages" PR carries the bumped pin with no workflow change.
- `@refkit/mcp` takes every workspace dependency bump (`updateInternalDependencies:
  patch`), so it moves on almost every release, and the plugin moves with it.
- A skill-only edit rides along with the next `@refkit/mcp` release. If it is urgent,
  add a `@refkit/mcp` patch changeset to force one. Users on a version-pinned install
  only get a new copy when `version` changes.

**Release-window risk:** the pin lands on `main` in the same merge that triggers
`npm publish`. For the minutes before publish finishes, a fresh install points at an
unpublished version. If publish fails (the expired-token case seen on 2026-09-22), the
plugin stays broken until `gh run rerun <id> --failed` succeeds. We accept this because
Claude Code doesn't auto-update third-party marketplaces by default, so existing users
keep the old pin. The runbook note goes in the root README's Develop section.

## BYOK keys (deferred)

v1 ships keyless: the 12 keyless sources answer out of the box. No `userConfig`, no
`env` in `.mcp.json`, and the plugin README doesn't tell users to export keys (the
directory holds plugins that read credentials from the environment).

Wiring BYOK later needs three things together, recorded here so the follow-up doesn't
rediscover them:

1. **Claude side:** `userConfig` options (`sensitive: true`, `default: ""` so Cowork
   doesn't drop the server) mapped into `env` as `REFKIT_<PROVIDER>_KEY`.
2. **A `cli.ts` fix:** key lookup uses `env.REFKIT_X ?? env.LEGACY_X`, so an empty
   `REFKIT_X` set by the plugin would hide a legacy-named key instead of falling back.
   Switch to `||` (and treat `""` as absent).
3. **Codex side:** a separate Codex-only MCP config without `${user_config.*}`, since
   `.mcp.json` can no longer be shared. Codex forwards env to stdio servers only
   through `env` / `env_vars`, and whether a plugin-declared server can set those needs
   checking.

## Codex startup timeout

Codex's default `startup_timeout_sec` for stdio MCP servers is 10 s. Measured on
2026-10-11 against `@refkit/mcp@0.8.2`:

- empty npm cache: 7.6 s to the first `initialize` response
- warm cache: 2.0 s

A slow network or registry could push a first launch past 10 s, and the server would
fail to start once. The next launch succeeds because the cache is warm. Implementation
checks this in real Codex. If a plugin `.mcp.json` entry may carry
`startup_timeout_sec`, add it there. Claude Code's validator must accept the extra key,
or it moves to a Codex-only file. Otherwise the README tells Codex users that a first
launch may time out once.

## Testing

Automated (`packages/mcp/src/__tests__/plugin-manifest.test.ts`, in the existing `mcp`
vitest project, so CI runs it with no workflow change):

- The `.mcp.json` pin, both manifest `version`s and `packages/mcp/package.json` version
  are equal.
- The `.mcp.json` `args` pin an exact semver, never a range or tag.
- `name` is `refkit` in both manifests and both catalogs, and both catalogs' sources
  resolve to `plugins/refkit`.
- Every `skills/*/SKILL.md` has parseable front matter with `name` equal to its folder
  and a single-line string `description`.
- The plugin folder has no `package.json`, lockfile, `.npmrc`, symlink or `.DS_Store`
  (all directory blockers or holds).
- `sync-plugin-version.mjs` is idempotent: running it on an in-sync tree changes
  nothing. Test it by importing its pure transform, not by spawning it.

Manual, before merge:

- `claude plugin validate --strict plugins/refkit` and `claude plugin validate .` (the
  catalog) both pass.
- Claude Code: `claude plugin marketplace add ./` → `claude plugin install refkit@refkit`
  → a fresh session asked "find CC0 forest textures I can ship in a game" triggers
  `find-references`, calls `search_references` with `gateFor: commercial-product`, and
  presents licenses and links.
- Codex (the user runs this; the Codex CLI isn't on this machine's PATH): add the
  local catalog, enable the plugin, run the same ask, and note the cold-start
  behaviour against the 10 s timeout.

## Phase 2: Anthropic directory (manual)

After v1 is on `main` and verified:

1. Add listing fields to `.claude-plugin/plugin.json`: `icon` (a PNG inside the plugin
   folder), `documentationUrl`, `supportUrl` (GitHub issues). Add `privacyPolicyUrl` /
   `termsOfServiceUrl` only if the portal requires them.
2. The README must stay at 40 words or more outside code blocks, and must disclose what
   the plugin runs and contacts: `npx` fetches `@refkit/mcp` from the npm registry, and
   searches go to the listed public source APIs.
3. The user submits from claude.ai/directory/manage → **Plugin bundle**, with repo
   `refkitjs/refkit`, folder `plugins/refkit`, tracking `main`, and fixes any
   **Blocking** findings. Expected holds for review: the pinned `npx` launcher.
4. A listed plugin reaches Claude Code users as `refkit@synced` and appears in
   `/plugin directory`, claude.ai Discover and Cowork. claude.ai chat ignores local MCP
   servers, so there it loads skills only.

## Risks

- **Codex compatibility gaps.** The `.codex-plugin` shape is OpenAI's fallback format.
  If Codex drops it, migrate to the portable root `plugin.json` + `mcp.json` (with
  `extensions.com.openai`). That is a manifest-only change.
- **Directory review outcome.** The pinned-npx hold is a human decision. If rejected,
  the self-hosted marketplace still serves everyone.
- **Release window** and **startup timeout**: covered above.
