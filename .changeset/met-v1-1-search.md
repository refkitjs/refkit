---
'@refkit/provider-met': patch
---

Met: search through `/public/collection/v1.1/search`. The Met retired `/v1/search` on 2026-10-01, and it now answers 410 Gone, so every Met search failed. The v1.1 endpoint takes the same filters and returns one page of object IDs per request, so the provider now asks for exactly the page it needs with `offset` and `limit` instead of downloading every matching ID and slicing it. Object records still come from `/v1/objects/{id}`. Every `providerOptions` filter is forwarded unchanged.
