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
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
