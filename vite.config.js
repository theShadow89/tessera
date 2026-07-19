import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// manifold-3d ships a .wasm asset that must not be pre-bundled, and the worker
// needs cross-origin isolation headers to be safe with SharedArrayBuffer paths.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // `vite preview` (serving the production build) needs the same isolation
  // headers as the dev server, or the WASM worker fails on the built bundle.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
  },
});
