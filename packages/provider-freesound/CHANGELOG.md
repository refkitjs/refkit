# @refkit/provider-freesound

## 0.3.0

### Minor Changes

- 991d467: Add first-class CC NC/ND license families: `CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-NC-ND`, `CC-BY-ND`.

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

### Patch Changes

- Updated dependencies [991d467]
- Updated dependencies [8300c18]
- Updated dependencies [c6b6061]
  - @refkit/core@0.6.0

## 0.2.0

### Minor Changes

- 2b16960: Add @refkit/provider-freesound: Freesound as license-normalized audio references (BYOK; per-item CC / CC0, CC name-string mapping with no version).

### Patch Changes

- Updated dependencies [2b16960]
  - @refkit/core@0.5.0
