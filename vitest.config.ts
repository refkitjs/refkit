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
    ],
  },
})
