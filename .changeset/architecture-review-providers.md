---
"@refkit/provider-openverse": patch
"@refkit/provider-pixabay": patch
"@refkit/provider-internet-archive": patch
"@refkit/provider-wikimedia-commons": patch
"@refkit/provider-artic": patch
"@refkit/provider-unsplash": patch
"@refkit/provider-flickr": patch
"@refkit/provider-smithsonian": patch
"@refkit/provider-freesound": patch
"@refkit/provider-jamendo": patch
"@refkit/provider-europeana": patch
"@refkit/provider-met": patch
"@refkit/provider-polyhaven": patch
---

Declare and honor the `page` search control (`capabilities.controls: ['page']`), wiring `controls.page` to each source's native pagination — native `page` params where they exist, offset translation for offset-based APIs (Wikimedia `gsroffset`, Smithsonian/Europeana `start`, Jamendo/ambientCG `offset`), and a window over the full result list for Met/Poly Haven. Enables core's unified load-more cursor across these sources. (Brave, PoetryDB, and Rijksmuseum expose no usable offset pagination and keep `page` undeclared.)
