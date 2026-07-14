# @refkit/provider-polyhaven

## 0.2.3

### Patch Changes

- 3cce5e3: Declare and honor the `page` search control (`capabilities.controls: ['page']`), wiring `controls.page` to each source's native pagination — native `page` params where they exist, offset translation for offset-based APIs (Wikimedia `gsroffset`, Smithsonian/Europeana `start`, Jamendo/ambientCG `offset`), and a window over the full result list for Met/Poly Haven. Enables core's unified load-more cursor across these sources. (Brave, PoetryDB, and Rijksmuseum expose no usable offset pagination and keep `page` undeclared.)
- Updated dependencies [3cce5e3]
  - @refkit/core@0.7.0

## 0.2.2

### Patch Changes

- 5b50432: Repo moved to the refkitjs GitHub org: add `repository` (with per-package `directory`), `homepage`, and `bugs` metadata to every public package, and point the gutendex default User-Agent at github.com/refkitjs/refkit.
- Updated dependencies [5b50432]
  - @refkit/core@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [991d467]
- Updated dependencies [8300c18]
- Updated dependencies [c6b6061]
  - @refkit/core@0.6.0

## 0.2.0

### Minor Changes

- 2b16960: Add @refkit/provider-polyhaven: Poly Haven and ambientCG (sibling factory `ambientcg`) as CC0-normalized image references (textures/HDRIs/materials; 3D model formats skipped for v1).

### Patch Changes

- Updated dependencies [2b16960]
  - @refkit/core@0.5.0
