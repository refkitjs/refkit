# @refkit/mcp

## 0.3.0

### Minor Changes

- 8c221f8: Add unified search controls, provider capability metadata, MCP controls input, search metadata/explanations, practical provider-specific `providerOptions` whitelists, and a core duplicate hook for agent-facing searches.

### Patch Changes

- Updated dependencies [8c221f8]
  - @refkit/core@0.4.0
  - @refkit/provider-unsplash@0.2.0
  - @refkit/provider-pexels@0.2.0
  - @refkit/provider-pixabay@0.2.0
  - @refkit/provider-flickr@0.2.0
  - @refkit/provider-brave@0.2.0
  - @refkit/provider-openverse@0.2.0
  - @refkit/provider-gutendex@0.2.0
  - @refkit/provider-poetrydb@0.2.0
  - @refkit/provider-wikimedia-commons@0.2.0
  - @refkit/provider-met@0.2.0
  - @refkit/provider-artic@0.2.0
  - @refkit/provider-smithsonian@0.2.0

## 0.2.0

### Minor Changes

- 451271b: - Zero-config `npx @refkit/mcp` server: a `bin` that boots with the keyless providers plus any BYOK provider whose key is in the environment — no host code.
  - Expose the use-verdict + attribution at the agent boundary: a new `intent` param annotates each result with `{ decision, reason, confidence }` (+ a ready-to-use attribution credit line) without filtering; `gateFor` still filters.
  - Report the real package version in the MCP `initialize` handshake (was hardcoded `0.0.0`).

### Patch Changes

- Updated dependencies [451271b]
- Updated dependencies [fa930f9]
  - @refkit/core@0.3.0
  - @refkit/provider-artic@0.1.2
  - @refkit/provider-brave@0.1.2
  - @refkit/provider-flickr@0.1.2
  - @refkit/provider-gutendex@0.1.2
  - @refkit/provider-met@0.1.2
  - @refkit/provider-openverse@0.1.2
  - @refkit/provider-pexels@0.1.2
  - @refkit/provider-pixabay@0.1.2
  - @refkit/provider-poetrydb@0.1.2
  - @refkit/provider-smithsonian@0.1.2
  - @refkit/provider-unsplash@0.1.2
  - @refkit/provider-wikimedia-commons@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [5e27c09]
  - @refkit/core@0.2.0
