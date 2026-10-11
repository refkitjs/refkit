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
