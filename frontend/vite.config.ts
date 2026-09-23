import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import segmentBuildPlugin from './scripts/segment-build-plugin.mjs'

export default defineConfig({
  plugins: [react(), segmentBuildPlugin()],
  server: { port: 5173, open: true },
})
