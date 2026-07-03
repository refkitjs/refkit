---
"@refkit/core": minor
"@refkit/mcp": minor
---

Harden the search orchestrator: per-provider soft timeout (default 10s) and
bounded retry on 429/5xx/network errors (default 1, exponential backoff) — on by
default, tunable or disabled via `createRefkit({ resilience })`. Provider
statuses in `searchWithMeta` now carry `latencyMs`, and supplying a `cache`
(`KeyValueCache`) now memoizes per-provider results (key
`refkit:v1:<provider>:<queryHash>`, TTL via the new `cacheTtlMs` option, default
5 min) with hits flagged `cached: true`. Merge, rerank, and the license gate
always run fresh. New exports: `withTimeout`, `retryingFetch`, and the
`ResilienceOptions`, `TimeoutHandle`, `RetryOptions` types.

The MCP `search_references` structured output (`explain: true`) now surfaces
`latencyMs` per provider and `cached` on cache hits.
