import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-freesound', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
