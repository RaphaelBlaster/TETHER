import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// chrome.scripting.executeScript loads files as classic scripts. Build the
// content entry independently as one IIFE so Rollup never leaves ESM imports
// to shared React/Three chunks at the top of content-script.js.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react()],
  build: {
    outDir: path.resolve(rootDir, 'dist'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(rootDir, 'src/content-script.js'),
      name: 'TetherContentScript',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
  },
})
