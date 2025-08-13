import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'c8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        'out/**',
        '.next/**',
        'tests/**',
        'scripts/**'
      ]
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', '.next', 'out']
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname
    }
  }
})