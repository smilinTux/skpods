import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The port is fixed because the OIDC redirect URIs (http://localhost:5174/ and http://localhost:5174/facility/) are registered with the pod server.
const ISSUER = process.env.VITE_POD_ISSUER ?? 'https://pods-dev.skstack01.douno.it'

// Same-origin proxy for pod resources that drops the Origin header (see src/lib/podproxy.ts for why).
const podProxy = {
  '/pod': {
    target: ISSUER,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/pod/, ''),
    configure: (proxy: any) => proxy.on('proxyReq', (req: any) => { req.removeHeader('origin'); req.removeHeader('referer') }),
  },
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, host: 'localhost', proxy: podProxy },
  preview: { port: 5174, strictPort: true, proxy: podProxy },
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), facility: resolve(__dirname, 'facility/index.html') } } },
})
