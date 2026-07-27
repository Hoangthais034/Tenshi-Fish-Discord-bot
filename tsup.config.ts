import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'cjs',
  outDir: 'dist',
  dts: true,
  external: ['ws', 'erela.js'],
  outExtension: () => ({ js: '.cjs' }),
})
