# @refkit/mcp

An MCP server that exposes refkit's **license-normalized reference search** (`search_references`) plus two stateless verdict tools (`evaluate_use`, `build_attribution`) as agent tools.

## Zero-config (`npx`)

Point any MCP client at:

```bash
npx -y @refkit/mcp
```

It boots with the keyless sources (Met, Art Institute of Chicago, Wikimedia Commons, Openverse + audio, Project Gutenberg, PoetryDB) and auto-adds any BYOK source whose key is in the environment. Each key is read as a unified `REFKIT_<PROVIDER>_KEY` name first, falling back to the provider's legacy name (both are honored indefinitely):

```bash
REFKIT_UNSPLASH_KEY=… REFKIT_PEXELS_KEY=… REFKIT_PIXABAY_KEY=… REFKIT_FLICKR_KEY=… REFKIT_SMITHSONIAN_KEY=… REFKIT_BRAVE_KEY=… npx -y @refkit/mcp

# legacy names still work:
UNSPLASH_KEY=… PEXELS_KEY=… PIXABAY_KEY=… FLICKR_KEY=… SI_KEY=… BRAVE_TOKEN=… npx -y @refkit/mcp
```

Example MCP client config:

```json
{ "mcpServers": { "refkit": { "command": "npx", "args": ["-y", "@refkit/mcp"] } } }
```

## Programmatic (bring your own providers)

The host owns wiring — which providers, which BYOK keys — and passes a configured `RefkitClient`:

```ts
import { serveStdio } from '@refkit/mcp'
import { createRefkit } from '@refkit/core'
import { openverse } from '@refkit/provider-openverse'
import { unsplash } from '@refkit/provider-unsplash'

await serveStdio(createRefkit({
  providers: [openverse(), unsplash({ accessKey: process.env.UNSPLASH_KEY! })],
  // fetch defaults to globalThis.fetch
}))
```

## The `search_references` tool

Input: `{ query, modalities?, controls?, filters?, providerOptions?, explain?, limit?, intent?, gateFor? }`.

- `controls` — provider-neutral search controls such as `{ orientation, color, language, sort, safety, license, media }`; providers translate supported controls and report ignored controls when `explain: true`.
- `intent` — annotate each result with a **use-verdict** for that intended use (no filtering).
- `gateFor` — return only results whose license allows that intent.
- `filters` — compatibility alias for `controls.orientation`, `controls.color`, and `controls.language`.
- `explain` — include provider status, applied and ignored unified controls, warnings, and gate/drop metadata.
- `providerOptions` — typed provider-specific whitelisted controls keyed by provider id, for example:

```json
{
  "query": "forest path",
  "modalities": ["image"],
  "controls": { "orientation": "landscape", "color": "green", "safety": "strict" },
  "providerOptions": {
    "unsplash": { "collections": ["abc", "def"], "page": 2 },
    "flickr": { "tags": ["forest", "path"], "tagMode": "all", "minTakenDate": "2020-01-01" },
    "brave": { "country": "US", "searchLang": "en" }
  }
}
```

Output: `{ references: [{ id, title?, modality, provider, canonicalUrl, license, thumbnail?, excerpt?, useVerdict?, useExplanation?, attribution? }], meta? }`. When `intent` (or `gateFor`) is set, each result carries `useVerdict { decision, reason, confidence }`, a plain `useExplanation`, and — if the license requires it — a ready-to-use `attribution` credit line. When `explain: true`, `meta` includes per-provider `fulfilled` / `failed` / `skipped` status, applied/ignored control details, warnings, and gate/drop counts.

> Results are references with a license id + source link — **not rights clearance, not legal advice**. `unknown` / `needs-review` results require the caller to verify the source's terms.

## The `evaluate_use` tool

Stateless: no search round-trip, no session cache — the caller supplies the rights fields directly.

Input: `{ license, licenseVersion?, author?, title?, canonicalUrl, intent, editorialOnly?, jurisdiction?, userJurisdiction? }`.

Output: `{ decision, reasons, confidence, disclaimer, attribution? }`. `attribution.text`/`.html` are included when `decision` is `allowed-with-attribution` (built from the same input fields via `buildAttribution`).

> Same conservative heuristic as `search_references`' use-gate — **not legal advice**. Every verdict carries a `disclaimer` and a `confidence`.

## The `build_attribution` tool

Input: `{ license, licenseVersion?, author?, title?, canonicalUrl }` → output `{ required, text?, html? }`. `required` is `false` (and `text`/`html` omitted) for licenses that need no attribution (e.g. `CC0-1.0`, `PD`).

## Discovery (web) source

refkit's clean providers give license-normalized results. For open-web **breadth** (e.g. "cyberpunk alley"), add the Brave discovery provider — its results carry `license: 'unknown'`, so refkit's use-gate returns `needs-review` for every one (never auto-allowed):

```ts
import { brave } from '@refkit/provider-brave'

createRefkit({
  providers: [
    openverse(),                                  // clean (license-normalized)
    brave({ token: process.env.BRAVE_TOKEN! }),   // discovery (license: unknown → needs-review)
  ],
})
```

Use discovery results for inspiration / internal moodboards; for commercial or generation use they're `needs-review` — verify the source first. Pass `gateFor: 'commercial-product'` to `search_references` to drop them automatically. Other web engines (Google CSE, Bing) are host-injectable via the same `ReferenceProvider` contract.
