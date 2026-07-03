---
"@refkit/core": minor
"@refkit/provider-openverse": minor
"@refkit/provider-flickr": minor
"@refkit/provider-wikimedia-commons": minor
"@refkit/provider-freesound": minor
"@refkit/provider-jamendo": minor
"@refkit/provider-europeana": minor
"@refkit/provider-internet-archive": minor
---

Add first-class CC NC/ND license families: `CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-NC-ND`, `CC-BY-ND`.

NC/ND-licensed results no longer collapse to `proprietary`: they keep their real
family id (+ CC version), generate the attribution the license requires, and
verdicts name the actual license in their reasons. Gating stays strict-deny —
commercial/AI use of NC content is still denied; NC × `redistribution` intent now
returns `needs-review` (was `denied`) because the intent cannot distinguish
commercial from non-commercial redistribution. `CC-BY-ND` now correctly allows
verbatim commercial reuse (`allowed-with-attribution`) while AI/derivative use
stays denied.

Note for TypeScript consumers: exhaustive `switch` statements over `LicenseId`
need arms for the four new ids.
