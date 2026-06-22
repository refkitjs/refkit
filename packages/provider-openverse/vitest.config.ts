import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-openverse', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
