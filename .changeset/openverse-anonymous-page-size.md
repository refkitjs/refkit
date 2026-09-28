---
'@refkit/provider-openverse': patch
'@refkit/provider-artic': patch
---

Openverse: anonymous requests now ask for at most 20 results. The API answers 401 ("page_size may not exceed 20 for anonymous requests") above that, which made every anonymous search fail under core's default fusion pool. Art Institute of Chicago: cap `limit` at 100, the API's per-page maximum (403 above it).
