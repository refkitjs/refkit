---
"@refkit/core": minor
"@refkit/provider-met": patch
"@refkit/provider-artic": patch
"@refkit/provider-openverse": patch
"@refkit/provider-unsplash": patch
"@refkit/provider-pexels": patch
"@refkit/provider-pixabay": patch
"@refkit/provider-gutendex": patch
"@refkit/provider-smithsonian": patch
"@refkit/provider-brave": patch
"@refkit/provider-flickr": patch
"@refkit/provider-wikimedia-commons": patch
---

Add shared provider helpers to @refkit/core (setIf* URL setters, first, mapCcDeedUrl, mapRightsUrl, image-URL heuristics) and refactor all providers to use them instead of per-package copies.
