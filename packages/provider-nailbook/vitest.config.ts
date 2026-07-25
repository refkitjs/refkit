import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-nailbook', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
