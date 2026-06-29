import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-jamendo', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
