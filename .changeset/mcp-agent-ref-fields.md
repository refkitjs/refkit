---
'@refkit/core': minor
'@refkit/mcp': minor
---

`search_references` results now carry what an agent needs to judge a match and handle the file: the source's `description` (capped at 280 characters), its first 8 `tags`, the `author`, the 0..1 cross-source `relevance`, and `rights.rehostPolicy`. The output schema and the tool description explain each `rehostPolicy` value, so agents know whether they may download, cache or only hotlink a result's media. The per-source `sourceScore` stays out because it is not comparable across sources. Core exports the policy values as `REHOST_POLICIES`, which its own schema now uses as well.
