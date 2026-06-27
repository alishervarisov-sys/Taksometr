import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../firebase/hosting',
    emptyOutDir: true,
  },
  server: {
    port: 3000
  }
})
