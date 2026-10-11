---
name: find-references
description: Use when the user wants reference or source material (images, artworks, photos, textures, HDRIs, 3D models, video, music, sound effects, poems or public-domain books) for a moodboard or a project, and needs to know whether each result may be used for their purpose.
---

# Find references with refkit

refkit's `search_references` tool searches open collections (museums, Wikimedia Commons, Openverse, Poly Haven, Project Gutenberg and more). Every result comes back with a normalized license id and a link to its source page. This skill is about using the tool well, which means judging results by what the user will *do* with them.

## 1. Pin down the intended use

The same CC BY-NC image is fine on a private moodboard and off-limits in an ad. Before searching, map the user's purpose to an intent:

| The user will… | intent |
| :- | :- |
| collect it for private inspiration, a moodboard, an internal pitch | `internal-moodboard` |
| ship it in a product, game, app, ad, merch or marketing | `commercial-product` |
| feed it to an image, video or music generator, or a training set | `ai-generation-input` |
| republish or redistribute the file itself | `redistribution` |

If the purpose is unclear and would change which results are acceptable, ask one short question. If the user is only browsing, use `internal-moodboard`.

## 2. Annotate or filter

- Pass `intent` to label every result with a `useVerdict` and keep everything. Good for browsing, because the user sees what is usable and what is not.
- Pass `gateFor` (same values) to keep only `allowed` and `allowed-with-attribution` results for that use. Use it when the user needs results they can actually use, typically for `commercial-product` or `ai-generation-input`. It drops everything whose license is unknown, including all web-discovery results.

Pass one of the two on every search the user will act on. A bare license id with no verdict is easy to misread.

## 3. Shape the query

- Use short, concrete nouns and adjectives ("storm at sea oil painting", "mossy rock texture"), not full sentences.
- `modalities` defaults to images. Set it for other media: `["audio"]` for music and sound effects, `["text"]` for poems and books, `["video"]` for footage.
- The tool description lists the configured sources and what each covers. Use `sources` to target one when the ask is domain-specific, for example Poly Haven for HDRIs and textures. Naming a source also makes a narrow source answer queries it would otherwise decline. Nailbook (Japanese nail art) declines off-topic queries unless named, and works best with Japanese tag words.
- Add `minRelevance` (0.5 keeps only real matches) when the user wants only close matches. Leave it off for broad exploration, because it can empty a batch.
- `limit` sets how many results come back.

## 4. Present results honestly

For each result worth showing, give:

- the title and the source (`provider`)
- the license id
- the verdict (`useVerdict.decision`) and its reason, in plain words
- the `attribution` line when present (the user must reproduce it wherever the work appears)
- the `canonicalUrl` and, when useful, the `thumbnail`

Group or flag results by verdict:

- `allowed`: usable for that intent, as far as the license facts go.
- `allowed-with-attribution`: usable if credited with the given line.
- `needs-review`: the license is unknown or unclear, or the jurisdiction differs. Tell the user to check the source page before using it. Never present it as usable.
- `denied`: not for this use. Say so and offer alternatives.

A `useVerdict.confidence` of `low` deserves a "double-check the source" note.

## 5. More results and diagnostics

- When a result has `nextCursor`, repeat the same search with `cursor` set to it to get the next batch without repeats. No `nextCursor` means the search is exhausted.
- If results are empty or off-topic, retry with `explain` set to true. The returned `meta` shows which sources answered, failed, were skipped or declined, and which controls were ignored. Adjust the query, `modalities` or `sources` accordingly rather than repeating the same call.
- For a time-boxed request, `deadlineMs` bounds the whole call and returns whatever arrived in time.

## 6. Not legal advice

Verdicts are a conservative heuristic over license facts each source declares. They are not rights clearance. Say so once, briefly, when the user is about to rely on a result commercially. Never tell the user a work is "cleared" or "safe to use".

For a question about one specific work the user already has, use the `check-usage-rights` skill instead.
