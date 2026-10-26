---
'@refkit/provider-polyhaven': patch
---

Poly Haven results are ranked by how well they match the query, then by popularity. A query word found as a word of an asset's name or id counts most, then a tag or category, then a match inside a longer word; ties go to the most-downloaded asset. Before, most matches tied and kept Poly Haven's alphabetical order, so "sunset HDRI" returned `aarfontein_dawn_2`, `aarfontein_dusk` and the like instead of the popular sunset skies. A query with no words now lists the most-downloaded assets first.

The asset list (about 1 MB per asset type) is downloaded once and reused for an hour by each provider instance, instead of on every search. Change that with the new `listTtlMs` option; `0` turns the cache off.
