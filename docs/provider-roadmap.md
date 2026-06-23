# refkit provider roadmap

Status as of 2026-06-23. Grounded in a web-verified landscape scan (104
candidate sources → 101 unique → 16 depth-verified). This is the contract for
expanding refkit's provider coverage; execute against it, not against memory.

## Current inventory (7 providers)

| Modality | Providers | Verdict |
|---|---|---|
| image | openverse, unsplash, pexels, pixabay | mainstream stock + the main CC aggregator — solid, **but two glaring omissions: Flickr, Wikimedia Commons** |
| text | gutendex (Project Gutenberg), poetrydb | thin — only PD books + a niche poetry DB |
| grey/discovery | brave | represents the web-search category; do **not** bulk-add more (every web source is `license:unknown`) |
| video / audio / icon·vector / 3d·texture | — | **no leg at all** |

The moat is per-item license normalization, so the highest-value additions are
mainstream sources that return **structured per-item license** (Flickr,
Wikimedia, the GLAM museum APIs), not more commodity stock or more grey web
search.

## §1 — Prerequisite: CC version axis (Phase 1, atomic, blocks everything)

The current `LicenseId` enum only models `CC-BY-4.0` / `CC-BY-SA-4.0`. Every
CC-BY/BY-SA at version 1.0–3.0 collapses to `unknown` → `needs-review`. The
landscape scan proved this is not hypothetical: Flickr, Wikimedia Commons and
Internet Archive serve large volumes of CC 2.0/2.5/3.0 content. Adding them as-is
would manufacture exactly the "too many unknowns" failure we want to avoid.

But the **permission profile of CC-BY is identical across versions** (commercial
✓, derivatives ✓, attribution required); same for CC-BY-SA (adds shareAlike).
Only the legal text and the deed URL differ by version — and those matter for
*attribution*, not for *gating*. So the id should encode the permission family;
the precise version is metadata.

This also fixes a pre-existing over-conservatism in our own openverse provider,
which today throws away CC-BY-2.0/3.0 results as `unknown`.

**Design (chosen):**
- `LicenseId`: rename `CC-BY-4.0` → `CC-BY`, `CC-BY-SA-4.0` → `CC-BY-SA`
  (family-level). `CC0-1.0` and `PD` stay as-is — CC0 has only one version, PD
  is a status, not a versioned license.
- `RightsRecord.licenseVersion?: string` — the precise CC version ("4.0", "3.0",
  …) for attribution/audit. Omitted for non-CC licenses. **Never** read by
  `evaluateUse` (permissions come from `LICENSE_FACTS[family]`).
- `buildAttribution`: when `licenseVersion` is present, render
  "licensed under CC-BY 4.0" (family + version); else "licensed under CC-BY".
- openverse mapper: drop the `version === '4.0'` gate — any-version `by`/`by-sa`
  → family id, and set `rights.licenseVersion = license_version`.

**Files (atomic — a partial rename leaves the build red, so it is one phase):**

refkit:
1. `packages/core/src/license.ts` — `LicenseId` union + `LICENSE_FACTS` keys.
2. `packages/core/src/rights.ts` — `licenseIdSchema` enum + add `licenseVersion?`
   to interface & schema.
3. `packages/core/src/attribution.ts` — `AttributionInput.licenseVersion?` +
   render version.
4. `packages/provider-openverse/src/index.ts` — `mapOpenverseLicense` drops the
   version gate; `toReference` sets `licenseVersion`.
5. core tests: `attribution`, `client`, `evaluate-use`, `license`, `rights`.
6. `provider-openverse` test — **invert** the "older CC-BY → unknown" case to
   "older CC-BY → CC-BY, allowed-with-attribution, version preserved". This is
   the proof the fix works.

Slate (consumes refkit via link — same atomic change):
7. `packages/core/src/retrieval/__tests__/reference-to-asset.test.ts` — test
   data `'CC-BY-4.0'` → `'CC-BY'` (+ `licenseVersion: '4.0'`), and the
   `metadata.license`/attribution assertions.

**Verify:** `pnpm -r typecheck` + `pnpm test:run` green in refkit; the retrieval
suite green in the Slate worktree.

Optional follow-up (not Phase 1): a `licenseDeedUrl(license, version?)` helper so
attribution links the exact CC deed instead of only the source page.

## §2 — P0 providers (mainstream + per-item clean license + i2i-usable)

Each is an independent `@refkit/provider-*` satellite. Build after Phase 1.

| Provider | Modality | Effort | Auth | License field (verified) | Mapping |
|---|---|---|---|---|---|
| **flickr** | image | M | BYOK free | per-item numeric `license` id; `search` supports server-side `license=` filter + `extras=license` | 9→CC0 · 4/11→CC-BY · 5/12→CC-BY-SA · 7/8/10→PD · 0(ARR)+NC/ND→proprietary (gate out before i2i) |
| **wikimedia-commons** | image | M | keyless | per-file `extmetadata.License` machine code (`cc0`,`pd`,`cc-by-sa-4.0`…) + `LicenseShortName` | per-item; default-filter `NonFree`/fair-use; blank/unrecognized → unknown |
| **met** (Met Museum) | image | S | keyless | `isPublicDomain` boolean (copyrighted items return empty `primaryImage`) | →CC0 (image modality is effectively whole-source CC0) |
| **artic** (Art Institute of Chicago) | image | S | keyless | `is_public_domain` boolean (filterable) | →CC0 |
| **smithsonian** | image | M | BYOK free (api.data.gov) | per-media `online_media[].usage.access == "CC0"` (~17.3M CC0) | →CC0 (do **not** confuse with metadata-level `metadata_usage.access`) |

Notes:
- Flickr + Wikimedia close the two biggest mainstream image gaps and are the
  textbook moat demos (deterministic per-item license).
- Met / Artic / Smithsonian are the highest-license-confidence sources in the
  whole landscape and add the "art / cultural reference" category. Met & Artic
  are effort S (≈ unsplash-clone).
- After §1, Flickr/Wikimedia's CC 2.x/3.0 items map correctly instead of dropping
  to unknown.

## §3 — P1 providers, modality gaps & cheap wins

**Cheapest wins first — reuse an existing integration's key + license mapping:**
- **openverse audio** — the openverse API already serves audio under the same
  key/shape; near-free audio leg.
- **pexels-video / pixabay-video** — same keys, same license as the image
  providers we already ship; a different endpoint adds the video leg cheaply.

**Other P1:**

| Provider | Leg | Caveat (verified) |
|---|---|---|
| rijksmuseum | image (art) | per-item CC0/PDM rights URIs; modern API at `data.rijksmuseum.nl` |
| europeana | image/mixed | per-item `edm:rights` controlled vocab; media bytes are third-party-hosted (hotlink), effort L |
| freesound | audio (SFX) | per-item CC, but license is a **name string, not URL**, no version |
| jamendo | audio (music) | per-item `license_ccurl`; only ~2 of 6 license types fit the enum, version mismatch |
| internet-archive | video / text | huge, but license is **dirty**: of 16.4M `movies`, only ~7.3% carry `licenseurl` |
| poly-haven / ambientcg | 3d / hdri / texture | CC0 whole-source (API exposes no per-item license field — hardcoded from ToS) |

## §4 — Skip list (do not build)

- **Paid rights-managed stock** (Getty, iStock, Shutterstock, Adobe Stock,
  Freepik): everything proprietary; nothing to normalize to a usable license.
- **No-API CC0 sites** (StockSnap, Burst, ISO Republic, Foodiesfeed, Negative
  Space, Life of Pix, Gratisography): clean license but no sanctioned API.
- **Kaboompics**: license **explicitly forbids AI training / AI image
  generation** — directly incompatible with refkit's i2i downstream. Hard skip;
  keep as the canonical "license-incompatible" example.
- **Lorem Picsum**: placeholder service, not searchable, Unsplash-backed.
- **The 8 web-search providers** (Tavily, Exa, Jina, SearXNG, Bocha, Zhipu,
  Querit, ExaMCP): all yield `license:unknown`; brave already represents the
  category. Bulk-adding them only multiplies unknowns.

## §5 — Sequencing

1. **Phase 1** — §1 CC version axis (atomic, refkit + Slate test). ← do first.
2. **Phase 2** — flickr + wikimedia-commons (the two mainstream image gaps).
3. **Phase 3** — met + artic + smithsonian (GLAM CC0 cluster; Met/Artic are S).
4. **Phase 4** — cheap modality wins: openverse-audio, pexels-video, pixabay-video.
5. **Phase 5+** — P1 backlog as demand dictates.

Phases 2–4 are independent per-package satellites → parallelizable via
worktree-isolated subagents (one provider per agent).
