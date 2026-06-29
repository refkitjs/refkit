import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-polyhaven', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
