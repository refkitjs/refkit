---
name: check-usage-rights
description: Use when the user has a specific work (a link, a license, an author) and asks whether they may use it for a purpose such as a product, an ad, AI generation or republishing, or how to credit it.
---

# Check usage rights with refkit

refkit's `evaluate_use` tool turns a work's license facts into a verdict for one intended use. refkit's `build_attribution` tool turns the same facts into the credit line the license asks for. Both are stateless: they judge only what you pass in, and fetch nothing.

## 1. Collect the license facts

| Argument | What to pass |
| :- | :- |
| `license` | One of the ids in the tool schema. Creative Commons licenses are family ids (`CC-BY`, `CC-BY-SA`, `CC-BY-NC`, …) with the version passed separately. Use `CC0-1.0` or `PD` for no rights reserved; `unsplash`, `pexels`, `pixabay` for those sites' own licenses; `proprietary` for all rights reserved; `unknown` when it can't be determined |
| `licenseVersion` | The Creative Commons version, such as `"4.0"`, when known. It only affects the credit line |
| `canonicalUrl` | The work's source page (required) |
| `author`, `title` | When known. They go into the credit line |
| `editorialOnly` | `true` when the source marks the work editorial-only |
| `jurisdiction`, `userJurisdiction` | The jurisdiction the source declares for a public-domain status, and where the user is, when known. A mismatch yields `needs-review` |

Do not guess the license. If the user hasn't given it:

- read it from the source page if you can open it, or
- if the work came from refkit's `search_references` tool, use that result's `license`.

If it still can't be determined, pass `unknown`. The verdict will be `needs-review`, which is the honest answer.

## 2. Map the use to an intent

Pass the user's purpose as `intent`:

| The user will… | intent |
| :- | :- |
| collect it for private inspiration, a moodboard, an internal pitch | `internal-moodboard` |
| ship it in a product, game, app, ad, merch or marketing | `commercial-product` |
| feed it to an image, video or music generator, or a training set | `ai-generation-input` |
| republish or redistribute the file itself | `redistribution` |

Ask one short question if the purpose is unclear. The answer often flips the verdict.

## 3. Call and report

Call `evaluate_use`, then report:

- the `decision` in plain words, with its `reasons`
- the `confidence`. On `low`, tell the user to double-check the source terms
- the `disclaimer`, once
- on `allowed-with-attribution`, the returned `attribution.text` (or `attribution.html` for a web page), and where it must appear: next to the work, or in the credits

When the user only needs the credit line, call `build_attribution` instead. If it returns `required: false` (for example for `CC0-1.0` or `PD`), say no credit is needed, and that crediting anyway is good practice.

## 4. When the answer is no

On `denied`, explain which license term blocks the use (the `reasons` say). On `needs-review`, say exactly what to verify at the source: the license itself, an editorial-only restriction, or the jurisdiction. In both cases, offer to find usable alternatives with `search_references` and `gateFor` set to the same intent (the `find-references` skill).

## Not legal advice

The verdict is a conservative heuristic over declared license facts, not rights clearance. Never tell the user a work is "cleared" or "safe to use".
