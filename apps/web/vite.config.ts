import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

/**
 * Serves MSW's service worker from node_modules in the dev server only. It is deliberately not in
 * `public/`, because everything in `public/` is copied into the production build.
 */
function devMockServiceWorker(): Plugin {
  return {
    name: 'terms:dev-mock-service-worker',
    apply: 'serve',
    configureServer(server) {
      const workerPath = require.resolve('msw/mockServiceWorker.js');
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        createReadStream(workerPath).pipe(res);
      });
    },
  };
}

const API_ORIGIN = process.env['TERMS_API_ORIGIN'] ?? 'http://localhost:3000';

export default defineConfig({
  // The repo keeps one .env at its root (.env.example). Only VITE_* values reach the browser.
  envDir: '../..',
  plugins: [react(), tailwindcss(), devMockServiceWorker()],
  resolve: {
    // Read @terms/shared from TypeScript source, so no watch build is needed (docs/api.md).
    conditions: ['@terms/source', ...defaultClientConditions],
  },
  optimizeDeps: {
    // Pre-bundle these up front. Otherwise the dev server finds them when a lazy screen first
    // loads, and reloads the page to re-optimise.
    include: ['ag-grid-community', 'ag-grid-enterprise', 'ag-grid-react'],
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: API_ORIGIN, changeOrigin: false } },
  },
  build: {
    target: 'es2023',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    testTimeout: 15000,
    server: { deps: { inline: [/@terms\/shared/] } },
  },
});
