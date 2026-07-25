---
"@refkit/core": minor
"@refkit/mcp": minor
---

Add source-targeted search. `SearchInput.sources?: string[]` restricts a search
to specific provider ids (intersected with modality matching); omit it to fan out
to every configured source as before. This lets a caller scope a search-engine
operator — e.g. `site:xiaohongshu.com` against Brave's index — to one
web-discovery source without polluting the other providers' queries.

Selection stays fail-loud: a `sources` list that matches no configured provider
for the requested modalities throws (a typo must not read as "no results"), while
an id that resolves to nothing when others still match is reported in
`meta.warnings`. Providers excluded by an explicit `sources` filter now report
`reason: 'not-selected'` in `meta.providers`, distinct from `'unsupported-modality'`.

`@refkit/mcp`'s `search_references` tool gains a `sources` parameter (its
description enumerates the server's enabled source ids) and turns a
source-selection miss into an agent-friendly tool error that lists the valid ids.
