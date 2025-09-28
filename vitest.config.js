import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Run tests sequentially to prevent database conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    // Alternative approach - set maxConcurrency to 1 
    maxConcurrency: 1,
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
    exclude: ['node_modules', '.next', 'out', 'tests/e2e/**']
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname
    }
  }
})