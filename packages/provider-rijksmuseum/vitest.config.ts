import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-rijksmuseum', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
