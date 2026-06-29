import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'provider-internet-archive', environment: 'node', include: ['src/**/*.{test,spec}.ts'] } })
