/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { providerDevProxyPlugin } from './vite/providerDevProxyPlugin';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), providerDevProxyPlugin()],
  optimizeDeps: {
    // Pre-bundle heavy deps up front so restarts are less likely to 504 in open tabs.
    include: ['zustand', '@xyflow/react'],
  },
  server: {
    // Fail fast when the default port is taken so the browser URL matches the terminal.
    strictPort: true,
    // Clickjacking protection (frame-ancestors only works via headers, not <meta> CSP).
    headers: { 'X-Frame-Options': 'DENY' },
    // Don't serve the production build through the dev server — dist/index.html
    // references /assets/*.js, which the dev server answers with index.html (MIME error).
    // Scope to the project output dir only; `**/dist/**` also blocks deps like @xyflow/react/dist/style.css.
    fs: { deny: ['dist/**'] },
  },
  preview: {
    strictPort: true,
    headers: { 'X-Frame-Options': 'DENY' },
  },
  // NOTE: these `headers` blocks only apply to `vite dev`/`vite preview`. A
  // production deployment serves `dist/` through its own host (static file
  // server, CDN, reverse proxy) which must independently set
  // `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`) — Vite has no
  // hook into that serving layer.
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors into their own chunks so app edits don't bust their
        // browser cache, and the initial parse is spread across files.
        manualChunks: {
          reactflow: ['@xyflow/react'],
          markdown: ['react-markdown', 'rehype-sanitize'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
