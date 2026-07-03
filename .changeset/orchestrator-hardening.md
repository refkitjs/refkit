---
"@refkit/core": minor
---

Harden the search orchestrator: per-provider soft timeout (default 10s) and
bounded retry on 429/5xx/network errors (default 1, exponential backoff) — on by
default, tunable or disabled via `createRefkit({ resilience })`. Provider
statuses in `searchWithMeta` now carry `latencyMs`, and supplying a `cache`
(`KeyValueCache`) now memoizes per-provider results (key
`refkit:v1:<provider>:<queryHash>`, TTL `cacheTtlMs`, default 5 min) with hits
flagged `cached: true`. Merge, rerank, and the license gate always run fresh.
New exports: `withTimeout`, `retryingFetch`, `ResilienceOptions`.
