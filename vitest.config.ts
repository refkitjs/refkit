import { defineConfig } from 'vitest/config'

// Root aggregator — each package registers a leaf config in `projects`.
export default defineConfig({
  test: {
    projects: [
      './packages/core/vitest.config.ts',
      './packages/provider-openverse/vitest.config.ts',
      './packages/provider-unsplash/vitest.config.ts',
      './packages/provider-pexels/vitest.config.ts',
    ],
  },
})
