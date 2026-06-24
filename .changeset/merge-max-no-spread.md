---
"@refkit/core": patch
---

Fix a latent stack overflow in `mergeReferences`: the RRF max-normaliser used
`Math.max(...score.values())`, which throws `RangeError: Maximum call stack size
exceeded` once the merged pool gets large (~10^5 unique results) — the same
spread-overflow already guarded against in `lexicalReranker`'s quality pass. It
now computes the max with a reduce loop, preserving the "top result relevance =
exactly 1.0" invariant, and the inaccurate "empty input returns [] earlier"
comment is corrected.
