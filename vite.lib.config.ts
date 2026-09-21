import { defineConfig } from 'vite';

/**
 * Library build — one ESM bundle from the public API entry, minified
 * by vite's default oxc pipeline (identifiers + syntax; vite keeps
 * ES-lib output pretty-printed by design). Types come from
 * `tsc -p tsconfig.lib.json` (build:lib runs both). The demo app has
 * its own config (vite.config.ts) and output dir.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    rolldownOptions: {
      output: {
        minify: true,
      },
    },
  },
});
