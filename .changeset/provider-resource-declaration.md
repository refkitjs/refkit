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
---

Provider resource declarations: open `ResourceKind` vocabulary with optional
`kinds` + `description` on providers and `kind` on references; kind-aware
routing and a `providers` id whitelist with new skip reasons
(`unsupported-kind`, `not-selected`); MCP tool schema, source list, and enums
now derived from registered provider declarations at startup.

Note: the MCP `modalities` and new `providers` input enums are now
deployment-dependent (derived from the registered providers). A request naming
a modality no registered provider supports is now rejected at the schema
boundary — previously a fully-unsupported request threw at search time, and a
mixed request (e.g. image+audio against an image-only deployment) returned the
supported subset. Fail-loud at the boundary is intentional.
