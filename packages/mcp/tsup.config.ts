import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: true,
  // tsup externalizes dependencies + peerDependencies but NOT optionalDependencies,
  // so without this the dynamically-imported BYOK providers get bundled INTO dist —
  // defeating --omit=optional, snapshotting provider code at publish time, and making
  // the "package not installed" fallback unreachable. Every @refkit/* package must
  // resolve at runtime from node_modules.
  external: [/^@refkit\//],
})
