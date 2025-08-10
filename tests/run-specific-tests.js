#!/usr/bin/env node

/**
 * Test runner for specific algorithm validation scenarios
 * 
 * Usage:
 *   node tests/run-specific-tests.js zero-vote-bug
 *   node tests/run-specific-tests.js tie-breaking
 *   node tests/run-specific-tests.js all
 */

import { spawn } from 'child_process'

const testSuites = {
  'zero-vote-bug': 'tests/__tests__/ranked-choice/zero-vote-elimination.test.js',
  'tie-breaking': 'tests/__tests__/ranked-choice/tie-breaking.test.js',
  'basic': 'tests/__tests__/ranked-choice/basic-scenarios.test.js',
  'edge-cases': 'tests/__tests__/ranked-choice/edge-cases.test.js',
  'all': 'tests/__tests__/ranked-choice/',
  'algorithm': 'tests/__tests__/ranked-choice/' // Alias for all ranking tests
}

function runTests(suite, options = {}) {
  const testPath = testSuites[suite]
  
  if (!testPath) {
    console.error(`❌ Unknown test suite: ${suite}`)
    console.error(`Available suites: ${Object.keys(testSuites).join(', ')}`)
    process.exit(1)
  }

  const vitestArgs = ['vitest', 'run', testPath]
  
  if (options.coverage) {
    vitestArgs.push('--coverage')
  }
  
  if (options.watch) {
    vitestArgs[1] = 'watch' // Replace 'run' with 'watch'
  }

  if (options.ui) {
    vitestArgs.push('--ui')
  }

  console.log(`🧪 Running ${suite} tests: ${testPath}`)
  console.log(`Command: npx ${vitestArgs.join(' ')}`)

  const child = spawn('npx', vitestArgs, {
    stdio: 'inherit',
    shell: true
  })

  child.on('close', (code) => {
    process.exit(code)
  })
}

// Parse command line arguments
const [,, suite, ...flags] = process.argv

if (!suite) {
  console.log(`
🧪 Ranking Algorithm Test Runner

Usage: node tests/run-specific-tests.js <suite> [options]

Test Suites:
  zero-vote-bug    Test the zero vote elimination bug fix
  tie-breaking     Test tie-breaking scenarios  
  basic           Test basic RCV functionality
  edge-cases      Test edge cases and boundary conditions
  algorithm       All ranking algorithm tests
  all             All ranking algorithm tests (alias)

Options:
  --coverage      Generate coverage report
  --watch         Run in watch mode
  --ui            Open Vitest UI

Examples:
  node tests/run-specific-tests.js zero-vote-bug
  node tests/run-specific-tests.js all --coverage
  node tests/run-specific-tests.js tie-breaking --watch
`)
  process.exit(0)
}

const options = {
  coverage: flags.includes('--coverage'),
  watch: flags.includes('--watch'),
  ui: flags.includes('--ui')
}

runTests(suite, options)