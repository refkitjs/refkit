---
"@refkit/provider-nailbook": minor
"@refkit/mcp": minor
---

New keyless provider `@refkit/provider-nailbook` — image references from Nailbook
(nailbook.jp), a large Japanese nail-design catalog. Recall is best with Japanese tag
words (マグネット, ニュアンス, ちゅるん…). Results are discovery-class: no per-item
license metadata, so each carries `license: 'unknown'` + `rehostPolicy: 'thumbnail-only'`
and gates to `needs-review` (never auto-allowed) — surface the CDN thumbnail only, never
rehost the original.

Rather than scraping the client-rendered `/design/` list HTML (whose embedded bootstrap
carries photo IDs but no image URLs), the provider calls the same JSON endpoint the site's
own frontend uses (`POST /api/web/photo/search`), returning full photo objects in one
request. Each `search()` makes exactly one request with no multi-page fan-out.

`@refkit/mcp` boots Nailbook in its zero-config keyless default set.
