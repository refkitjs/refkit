import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-poetrydb', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
