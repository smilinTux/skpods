import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The port is fixed because the OIDC redirect URI (http://localhost:5176/) is registered with the pod server.
export default defineConfig({
  plugins: [react()],
  server: { port: 5176, strictPort: true, host: 'localhost' },
  preview: { port: 5176, strictPort: true },
})
