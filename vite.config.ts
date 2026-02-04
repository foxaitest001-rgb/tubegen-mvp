
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crossOriginIsolation(), // Enables SharedArrayBuffer for WASM multi-threading
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/piper-tts-web/dist/onnx/*',
          dest: 'onnx' // Serves at /onnx/
        },
        {
          src: 'node_modules/piper-tts-web/dist/piper/*',
          dest: 'piper' // Serves at /piper/
        },
      ]
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
