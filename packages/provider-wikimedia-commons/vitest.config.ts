import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-wikimedia-commons', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
