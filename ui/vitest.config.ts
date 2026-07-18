import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// UI test harness (implementation plan Step 0.1). Unit tests for the pure
// lib/ modules plus one mock-mode App smoke test — lib/api.ts falls back to
// MOCK_ITEMS when the window.tailor bridge is absent, which it is under jsdom.
export default defineConfig({
  root: dir,
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(dir, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
