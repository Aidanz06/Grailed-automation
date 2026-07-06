import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Renderer app for Tailor Studio. Root is ui/; built output goes to ui/dist so
// Electron can load it via file://. base './' keeps asset paths relative.
export default defineConfig({
  root: dir,
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(dir, 'src') },
  },
  build: {
    outDir: path.resolve(dir, 'dist'),
    emptyOutDir: true,
  },
  // PORT lets the preview harness assign a free port; 5178 stays the default
  // for manual `npm run ui:dev`.
  server: { port: Number(process.env.PORT) || 5178, strictPort: true },
});
