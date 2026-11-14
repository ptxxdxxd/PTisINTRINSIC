import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the same build works at a domain root or under a
  // project path such as GitHub Pages.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // The viewport chunk is three.js: 560 kB minified, 139 kB gzipped. It is
    // loaded after first paint.
    chunkSizeWarningLimit: 600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The numerical core, and the parts of the app that are plain functions.
      include: ['src/core/**/*.ts', 'src/app/{model,protocol,fields,colormap}.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
