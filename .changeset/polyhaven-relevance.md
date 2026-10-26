---
'@refkit/provider-polyhaven': patch
---

Poly Haven results are ranked by how well they match the query, then by popularity. A query word found as a word of an asset's name or id counts most, then a tag or category, then a match inside a longer word; ties go to the most-downloaded asset. Before, most matches tied and kept Poly Haven's alphabetical order, so "sunset HDRI" returned `aarfontein_dawn_2`, `aarfontein_dusk` and the like instead of the popular sunset skies. An empty query now lists the most-downloaded assets first. Query words may be in any script (`crème`, `日落`); a query that matches no asset, including one made only of punctuation, returns nothing.

The asset list (about 1 MB per asset type) is downloaded once and reused for an hour by each provider instance, instead of on every search. Change that with the new `listTtlMs` option; `0` turns the cache off. A shared list download still unfinished after 30 seconds fails the searches waiting on it; if a host allows Poly Haven searches longer than that, `listTtlMs: 0` restores one download per search, bounded only by the host's own timeout.
