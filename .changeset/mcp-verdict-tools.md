---
"@refkit/mcp": minor
---

New stateless `evaluate_use` and `build_attribution` MCP tools — evaluate a
license against an intended use, or build an attribution credit line, without a
search round-trip. Zero-config `defaultProviders` now reads unified
`REFKIT_<PROVIDER>_KEY` env names first (`REFKIT_UNSPLASH_KEY`,
`REFKIT_PEXELS_KEY`, `REFKIT_PIXABAY_KEY`, `REFKIT_FLICKR_KEY`,
`REFKIT_SMITHSONIAN_KEY`, `REFKIT_BRAVE_KEY`, `REFKIT_FREESOUND_KEY`,
`REFKIT_JAMENDO_CLIENT_ID`, `REFKIT_EUROPEANA_KEY`), falling back to the legacy
names (`UNSPLASH_KEY`, `PEXELS_KEY`, `PIXABAY_KEY`, `FLICKR_KEY`, `SI_KEY`,
`BRAVE_TOKEN`, `FREESOUND_TOKEN`, `JAMENDO_CLIENT_ID`, `EUROPEANA_KEY`), which
are still honored.
