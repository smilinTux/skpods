import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The port is fixed because the OIDC redirect URIs (http://localhost:5174/ and http://localhost:5174/facility/) are registered with the pod server.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, host: 'localhost' },
  preview: { port: 5174, strictPort: true },
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), facility: resolve(__dirname, 'facility/index.html') } } },
})
