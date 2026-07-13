/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
