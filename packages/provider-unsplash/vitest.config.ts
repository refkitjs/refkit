import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-unsplash', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
