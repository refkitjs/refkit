# @refkit/provider-openverse

## 0.3.3

### Patch Changes

- Updated dependencies [b5bbba8]
- Updated dependencies [aa4b048]
  - @refkit/core@0.8.0

## 0.3.2

### Patch Changes

- 3cce5e3: Declare and honor the `page` search control (`capabilities.controls: ['page']`), wiring `controls.page` to each source's native pagination — native `page` params where they exist, offset translation for offset-based APIs (Wikimedia `gsroffset`, Smithsonian/Europeana `start`, Jamendo/ambientCG `offset`), and a window over the full result list for Met/Poly Haven. Enables core's unified load-more cursor across these sources. (Brave, PoetryDB, and Rijksmuseum expose no usable offset pagination and keep `page` undeclared.)
- Updated dependencies [3cce5e3]
  - @refkit/core@0.7.0

## 0.3.1

### Patch Changes

- 5b50432: Repo moved to the refkitjs GitHub org: add `repository` (with per-package `directory`), `homepage`, and `bugs` metadata to every public package, and point the gutendex default User-Agent at github.com/refkitjs/refkit.
- Updated dependencies [5b50432]
  - @refkit/core@0.6.1

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

## 0.2.1

### Patch Changes

- 2b16960: Add shared provider helpers to @refkit/core (setIf\* URL setters, first, mapCcDeedUrl, mapRightsUrl, image-URL heuristics) and refactor all providers to use them instead of per-package copies.
- Updated dependencies [2b16960]
  - @refkit/core@0.5.0

## 0.2.0

### Minor Changes

- 8c221f8: Add unified search controls, provider capability metadata, MCP controls input, search metadata/explanations, practical provider-specific `providerOptions` whitelists, and a core duplicate hook for agent-facing searches.

### Patch Changes

- Updated dependencies [8c221f8]
  - @refkit/core@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [451271b]
- Updated dependencies [fa930f9]
  - @refkit/core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [5e27c09]
  - @refkit/core@0.2.0
