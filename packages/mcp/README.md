# @refkit/mcp

An MCP server that exposes refkit's **license-normalized reference search** (`search_references`) plus two stateless verdict tools (`evaluate_use`, `build_attribution`) as agent tools.

## Zero-config (`npx`)

Point any MCP client at:

```bash
npx -y @refkit/mcp
```

It boots with the keyless sources (Met, Art Institute of Chicago, Wikimedia Commons, Openverse + audio, Project Gutenberg, PoetryDB, Rijksmuseum, Poly Haven, ambientCG, Internet Archive, Nailbook — Japanese nail-art, discovery-class `license: 'unknown'`, best queried with Japanese tag words, and the one source that *declines* queries outside its domain) and auto-adds any BYOK source whose key is in the environment. Each key is read as a unified `REFKIT_<PROVIDER>_KEY` name first, falling back to the provider's legacy name (both are honored indefinitely):

```bash
REFKIT_UNSPLASH_KEY=… REFKIT_PEXELS_KEY=… REFKIT_PIXABAY_KEY=… REFKIT_FLICKR_KEY=… REFKIT_SMITHSONIAN_KEY=… REFKIT_BRAVE_KEY=… npx -y @refkit/mcp

# legacy names still work:
UNSPLASH_KEY=… PEXELS_KEY=… PIXABAY_KEY=… FLICKR_KEY=… SI_KEY=… BRAVE_TOKEN=… npx -y @refkit/mcp
```

If your MCP client clamps tool-output strings, `REFKIT_MAX_CURSOR_SEEN` shrinks the load-more cursor: it caps how many already-returned keys `nextCursor` remembers (default 500 ≈ 2.7k chars; `REFKIT_MAX_CURSOR_SEEN=200` ≈ 1.1k). A lower cap only risks re-showing results from that many batches ago on very deep pagination.

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

Input: `{ query, modalities?, sources?, controls?, providerOptions?, limit?, cursor?, rerank?, minRelevance?, deadlineMs?, intent?, gateFor?, gateContext?, explain? }`.

- `controls` — provider-neutral search controls such as `{ orientation, color, language, sort, safety, license, media, page }`; providers translate supported controls and report ignored controls when `explain: true`.
- `sources` — restrict the search to specific source ids (the ids are listed in the tool description under "Configured sources"). Naming a source also **bypasses** that source's own query-acceptance predicate, so a narrow source like Nailbook — which declines non-nail queries on an unscoped search and then appears as `skipped` with `reason: 'declined'` — still answers when asked for by name.
- `rerank` — **default true**: results are re-ranked for the query (term coverage incl. CJK over title/description/tags/excerpt, the fused cross-source relevance, resolution, source and near-duplicate diversity). Pass `false` for raw cross-source rank fusion order. `true` cannot re-enable reranking when the host built the client with `rerank: false`.
- `minRelevance` — drop results the ranker scored below this (0…1), reported as `meta.threshold { minRelevance, dropped }`. The bar is graded against the reranker's *blended* score: under the stock weights a result matching no query term still lands near `0.3` and a full match near `0.95`, so `0.5` is the practical "real matches only" line. It does **not** transfer to `rerank: false`, where max-normalised fusion puts the top result at exactly `1`.
- `deadlineMs` — bound the whole call (cursor page advances included). Sources still in flight are reported as `failed` and the rest are returned. It is a hard bound while the host leaves per-source resilience on (the default); with resilience disabled it binds only sources that honour the abort signal.
- `intent` — annotate each result with a **use-verdict** for that intended use (no filtering).
- `gateFor` — return only results whose license allows that intent.
- `gateContext` — `{ userJurisdiction }` for that gate, matching `evaluate_use`'s jurisdiction input: a source-declared jurisdiction that differs from the caller's defaults to `needs-review`, which `gateFor` then drops.
- `cursor` — the previous result's top-level `nextCursor` (always returned, no `explain` needed); fetches the next batch, deduped against earlier ones.
- `explain` — include provider status (incl. per-source `confidence`, `latencyMs`, skip `reason`), applied and ignored unified controls, warnings, and gate/threshold-drop metadata.
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

Output: `{ references: [{ id, title?, modality, kind?, provider, canonicalUrl, license, thumbnail?, excerpt?, useVerdict?, useExplanation?, attribution? }], nextCursor?, meta? }`. When `intent` (or `gateFor`) is set, each result carries `useVerdict { decision, reason, confidence }`, a plain `useExplanation`, and — if the license requires it — a ready-to-use `attribution` credit line. When `explain: true`, `meta` includes per-provider `fulfilled` / `failed` / `skipped` status, applied/ignored control details, warnings, and gate/threshold-drop counts. The `meta` shape comes from core's own `searchMetaSchema` — this server keeps no copy of the vocabulary.

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
