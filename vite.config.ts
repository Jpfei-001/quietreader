import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { storageDiagnosticCollector } from './scripts/storageDiagnosticCollector';

export default defineConfig(({ mode }) => ({
  plugins: [storageDiagnosticCollector(), react()],
  // Desktop releases copy only explicit product-owned files after building.
  publicDir: mode === 'desktop' ? false : 'public',
  build: { sourcemap: false, emptyOutDir: true },
  clearScreen: false,
  // Keep diagnostics same-origin: Vite's CORS preflight middleware runs before plugin hooks.
  preview: { cors: false },
  server: {
    cors: false,
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.tools/**'] },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/*.test.mjs'],
    environment: 'node',
  },
}));
