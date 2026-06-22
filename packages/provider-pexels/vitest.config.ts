import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-pexels', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
