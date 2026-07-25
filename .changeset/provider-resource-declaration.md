---
'@refkit/core': minor
'@refkit/mcp': minor
'@refkit/provider-testkit': minor
'@refkit/provider-unsplash': minor
'@refkit/provider-pexels': minor
'@refkit/provider-pixabay': minor
'@refkit/provider-flickr': minor
'@refkit/provider-brave': minor
'@refkit/provider-wikimedia-commons': minor
'@refkit/provider-openverse': minor
'@refkit/provider-met': minor
'@refkit/provider-artic': minor
'@refkit/provider-rijksmuseum': minor
'@refkit/provider-smithsonian': minor
'@refkit/provider-europeana': minor
'@refkit/provider-freesound': minor
'@refkit/provider-jamendo': minor
'@refkit/provider-gutendex': minor
'@refkit/provider-poetrydb': minor
'@refkit/provider-internet-archive': minor
'@refkit/provider-polyhaven': minor
'@refkit/provider-nailbook': minor
---

Provider resource declarations: open `ResourceKind` vocabulary with optional
`kinds` + `description` on providers and `kind` on references; declaration-gated
kind routing (a kind-filtered search skips providers whose declared `kinds`
lack the value, with a new `unsupported-kind` skip reason) composed with the
existing `sources` id filter; MCP tool schema, per-provider source list, and
the `modalities` / `media.kind` enums now derived from registered provider
declarations at startup.

Note: the MCP `modalities` input enum is now deployment-dependent (derived
from the registered providers). A request naming a modality no registered
provider supports is now rejected at the schema boundary — previously a
fully-unsupported request threw at search time, and a mixed request (e.g.
image+audio against an image-only deployment) returned the supported subset.
Fail-loud at the boundary is intentional.
