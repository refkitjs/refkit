---
"@refkit/mcp": minor
---

- `search_references` gains `rerank: true` (query-aware re-ranking via `lexicalReranker`, CJK-aware) and `cursor` (load-more pagination with cross-page dedup; the next cursor rides on `meta.nextCursor` with `explain: true`).
- BYOK provider packages moved from `dependencies` to `optionalDependencies` and are now loaded lazily, only when their key is present. Default installs (incl. `npx -y @refkit/mcp`) still get everything; installs with `--omit=optional` skip BYOK sources, and a key whose package is missing logs a stderr warning instead of crashing. `defaultProviders()` is now async.
