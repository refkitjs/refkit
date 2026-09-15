# @refkit/provider-nailbook

Search **Nailbook** ([nailbook.jp](https://nailbook.jp)) — a large Japanese nail-design catalog — as image references, a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Nailbook ([nailbook.jp](https://nailbook.jp))
- **Auth:** keyless
- **Modality:** image
- **License:** `unknown` (discovery-class — see below)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { nailbook } from '@refkit/provider-nailbook'

const refkit = createRefkit({ providers: [nailbook()] })
const refs = await refkit.search({ query: 'マグネット', modalities: ['image'] })
```

## Query language

Recall is best with **Japanese** tag words — `マグネット` (magnetic), `ニュアンス` (nuance),
`ちゅるん` (glossy/jelly), `フレンチ` (french), etc. English or Chinese queries recall
poorly; translating the user's intent into Japanese tag vocabulary is the caller's
(host skill's) job.

## Query acceptance (this source declines off-topic searches)

Nailbook indexes nothing but nail designs, so it declares core's `accepts` predicate and
**declines** any query that does not name nails — in English (`nail`, `manicure`, `gel`),
Japanese (`ネイル`, `ジェル`, `マニキュア`) or Chinese (`美甲`, `指甲`, `甲油`). `nail` inside
`snail` does not count. A declined search never issues a request: the source is reported in
`meta.providers` as `skipped` with `reason: 'declined'`, and the other configured sources
answer alone (a decline is routing, not a failure — no warning, no error).

Naming the source explicitly bypasses acceptance, which is how a motif-only query still
reaches it:

```ts
await refkit.search({ query: 'lion', modalities: ['image'] })                        // declined
await refkit.search({ query: '桜', modalities: ['image'], sources: ['nailbook'] })   // runs
```

## Rights: discovery-class, not license-cleared

Nailbook photos are user-posted nail-art shots with **no per-item license metadata**, so
every result carries `license: 'unknown'` and `rehostPolicy: 'thumbnail-only'`. refkit's
use-gate therefore returns `needs-review` for all of them (never auto-allowed). Treat them
as visual **inspiration / moodboard** references — verify the source before any commercial
or generation use. Pass `gateFor: 'commercial-product'` to drop them automatically. Only
the resized CDN thumbnail is safe to surface; never rehost the original image.

## Crawler politeness

Each `search()` makes exactly **one** request and does **no** multi-page fan-out — this is
interactive, on-demand retrieval, not batch crawling. nailbook.jp's `robots.txt` is open to
general agents (it blocks AI-training crawlers specifically) with a `Crawl-delay: 10` that
applies to crawlers; a single request per user query is well within that spirit.

## Implementation note

nailbook.jp is a client-rendered SPA: the `/design/` list HTML embeds only a thin bootstrap
(photo IDs, no image URLs). This provider instead calls the same JSON endpoint the site's own
frontend uses (`POST /api/web/photo/search`), which returns full photo objects — image CDN
`base_url`, dimensions, caption, tags, author — in a single request. Pagination there is a
stateful `scrolling_key` cursor (the `page` parameter is a no-op), so this provider surfaces
one page per query and declares no `page` control.

See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API, and gate by
intended use with `refkit.evaluateUse(ref, 'commercial-product')`.
