import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'auth/index': 'src/auth/index.ts',
    'query/index': 'src/query/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  banner: {
    js: '"use client";',
  },
  clean: true,
})
