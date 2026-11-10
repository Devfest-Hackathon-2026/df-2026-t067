import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const apiProxy = { '/api': { target: 'http://127.0.0.1:8787' } }

export default defineConfig({
  plugins: [react()],
  build: { manifest: true },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: apiProxy,
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: apiProxy },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
