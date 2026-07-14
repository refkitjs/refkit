---
"@refkit/provider-openverse": patch
"@refkit/provider-pixabay": patch
"@refkit/provider-internet-archive": patch
"@refkit/provider-wikimedia-commons": patch
"@refkit/provider-artic": patch
---

Declare and honor the `page` search control (`capabilities.controls: ['page']`), wiring `controls.page` to each source's native pagination (Wikimedia Commons translates it to `gsroffset`). Enables core's unified load-more cursor across these sources.
