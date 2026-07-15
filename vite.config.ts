/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { providerDevProxyPlugin } from './vite/providerDevProxyPlugin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8')) as { version: string };

function getBuildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'dev';
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // GitHub Pages serves this repo under /multi-agent-playground/; keep "/" for local dev/preview.
  base: process.env.GITHUB_PAGES === 'true' ? '/multi-agent-playground/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(getBuildId()),
  },
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
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow/react')) return 'reactflow';
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/rehype-sanitize')) {
            return 'markdown';
          }
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
