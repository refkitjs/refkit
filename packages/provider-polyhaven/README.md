# @refkit/provider-polyhaven

Search **Poly Haven** as license-tagged image references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)). This package also ships a sibling factory, **`ambientcg()`**, for [ambientCG](https://ambientcg.com).

- **Source:** Poly Haven ([polyhaven.com](https://polyhaven.com)) + ambientCG ([ambientcg.com](https://ambientcg.com))
- **Auth:** keyless
- **Modality:** image
- **License:** CC0 (whole-source — every reference is `CC0-1.0`)

## Image-only (3D model formats skipped)

refkit's core modalities are `image | video | audio | text` — there is no `3d`/`texture` modality. Poly Haven and ambientCG host textures, HDRIs, and PBR materials whose individual maps are image files, so each reference is emitted as `modality: 'image'` surfacing only the image-format preview (a texture's diffuse `.jpg`/`.png`, an HDRI's tonemapped `.jpg`, or a material's PNG preview). **3D model formats are skipped for v1** — `.blend` / `.gltf` / `.fbx` / `.mtlx` / `.usd` and HDR/EXR files are not returned.

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { polyhaven } from '@refkit/provider-polyhaven'

const refkit = createRefkit({ providers: [polyhaven(/* config */)] })
const refs = await refkit.search({ query: 'asphalt', modalities: ['image'] })
```

### ambientCG sibling factory

`ambientcg()` lives in the same package and returns the same CC0-normalized image references, hitting ambientCG's API instead:

```ts
import { polyhaven, ambientcg } from '@refkit/provider-polyhaven'

const refkit = createRefkit({ providers: [polyhaven(), ambientcg()] })
const refs = await refkit.search({ query: 'tiles', modalities: ['image'] })
```

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
