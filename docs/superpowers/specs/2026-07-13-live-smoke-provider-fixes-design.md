# Live Smoke Provider Fixes Design

## Goal

Restore the weekly keyless live-smoke workflow by fixing the three deterministic provider failures revealed by run `29229284714`, without changing Gutendex behavior on the basis of a single non-reproducible 403.

## Scope

- Internet Archive must ask the upstream search API only for the `movies` and `texts` media types that the provider can map, before applying the requested row limit.
- PoetryDB must translate the normalized query limit into the upstream `poemcount` input so broad line searches remain bounded. Explicit provider options continue to take precedence, and `random` must not be combined with an implicit `poemcount`.
- Rijksmuseum must stop sending the unsupported `pageSize` parameter and must consume the current one-hop `edm-framed` JSON-LD representation instead of parsing the N-Triples `la` profile as JSON.
- Gutendex receives no code change in this implementation. Re-run evidence decides whether a later diagnostics or self-hosting change is warranted.

## Data Flow

Each provider continues to receive a `NormalizedQuery` and injected `ProviderContext.fetch`. The fix stays inside each provider package: construct a valid bounded upstream request, map the returned provider-native payload to `Reference`, and preserve the existing provider IDs, canonical IDs, rights mapping, and result limits.

For Rijksmuseum, collection search still returns object IDs. At most `n` IDs are selected locally, then each ID is fetched once with `_profile=edm-framed`. The aggregation supplies `aggregatedCHO` metadata, `edmRights`, `isShownAt`, and `isShownBy`; no additional Linked Art graph traversal is introduced.

## Error Handling

Existing provider-level non-2xx errors remain errors. Rijksmuseum continues to tolerate one bad record fetch without dropping successful siblings. Live smoke remains the integration guard for upstream contract drift.

## Verification

Every production change follows a red-green unit test. Final verification runs the three targeted unit suites, the three keyless live suites, `pnpm typecheck`, `pnpm test:run`, `pnpm build`, and `git diff --check`. Gutendex is re-probed separately and is reported as residual external risk if its 403 cannot be reproduced.
