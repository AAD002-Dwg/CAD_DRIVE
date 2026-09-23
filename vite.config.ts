import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          // MTEXT renderer worker
          src: 'node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js',
          dest: 'assets'
        },
        {
          // LibreDWG parser worker
          src: 'node_modules/@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js',
          dest: 'assets'
        },
        {
          // LibreDWG WASM binary
          src: 'node_modules/@mlightcad/libredwg-converter/dist/libredwg-web.wasm',
          dest: 'assets'
        }
      ]
    })
  ],
  optimizeDeps: {
    exclude: ['@mlightcad/cad-simple-viewer', '@mlightcad/libredwg-converter']
  }
})
