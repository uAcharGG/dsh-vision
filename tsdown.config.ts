/**
 * Standalone host-half build for dsh-vision-plugin (installed through
 * dsh-launcher, never merged into the deepseek-harness checkout).
 *
 * Only the node half is rebuilt here: lib/index.js (the host Loader row,
 * including the self-healing attachment patch) plus lib/invariant.js. The
 * browser bundle (lib/client.js) and the typert-generated faces
 * (lib/typert.host.js / lib/typert.remote-client.js) are build-time artifacts
 * that already exist; this config deliberately leaves them untouched.
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: '@uachar/dsh-vision-plugin',
  entry: { index: 'lib/types/index.js', invariant: 'lib/types/invariant.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^@uachar\//],
  },
  outputOptions: {
    entryFileNames: '[name].js',
  },
})
