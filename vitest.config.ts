import { defineConfig } from 'vitest/config'

// Root aggregator — each package registers a leaf config in `projects`.
export default defineConfig({
  test: {
    projects: [
      './packages/core/vitest.config.ts',
      './packages/provider-openverse/vitest.config.ts',
      './packages/provider-unsplash/vitest.config.ts',
      './packages/provider-pexels/vitest.config.ts',
      './packages/provider-pixabay/vitest.config.ts',
      './packages/provider-gutendex/vitest.config.ts',
      './packages/provider-poetrydb/vitest.config.ts',
      './packages/mcp/vitest.config.ts',
      './packages/provider-brave/vitest.config.ts',
      './packages/provider-flickr/vitest.config.ts',
      './packages/provider-wikimedia-commons/vitest.config.ts',
      './packages/provider-met/vitest.config.ts',
      './packages/provider-artic/vitest.config.ts',
      './packages/provider-smithsonian/vitest.config.ts',
      './packages/provider-rijksmuseum/vitest.config.ts',
      './packages/provider-polyhaven/vitest.config.ts',
      './packages/provider-freesound/vitest.config.ts',
      './packages/provider-jamendo/vitest.config.ts',
      './packages/provider-europeana/vitest.config.ts',
      './packages/provider-internet-archive/vitest.config.ts',
    ],
  },
})
