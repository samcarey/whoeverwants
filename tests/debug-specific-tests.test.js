// Simple test to see actual results - run with: npm test -- debug-specific-tests.js

import { describe, it } from 'vitest'
import { createPoll } from './helpers/poll-builder.js'

describe('Debug Actual Results', () => {
  it('Test 1: What actually happens', async () => {
    console.log('\n=== TEST 1 ACTUAL RESULTS ===')
    const result = await createPoll(['A', 'B', 'C', 'D'])
      .withVotes([
        ['A', 'C', 'D', 'B'],  
        ['B', 'C', 'A', 'D'],  
        ['C', 'A', 'B', 'D'],  
        ['D', 'A', 'C', 'B']   
      ])
      .run()
    console.log('WINNER:', result.winner)
    console.log('ROUNDS:', JSON.stringify(result.rounds, null, 2))
  })

  it('Test 2: What actually happens', async () => {
    console.log('\n=== TEST 2 ACTUAL RESULTS ===')
    const result = await createPoll(['A', 'B', 'C', 'D', 'E'])
      .withVotes([
        ['A', 'B', 'C', 'D', 'E'],
        ['A', 'C', 'B', 'D', 'E'],  
        ['B', 'C', 'A', 'D', 'E'],
        ['C', 'B', 'A', 'D', 'E'],
        ['D', 'C', 'B', 'A', 'E']
      ])
      .run()
    console.log('WINNER:', result.winner)
    console.log('ROUNDS:', JSON.stringify(result.rounds, null, 2))
  })

  it('Test 3: What actually happens', async () => {
    console.log('\n=== TEST 3 ACTUAL RESULTS ===')
    const result = await createPoll(['A', 'B', 'C', 'D', 'E'])
      .withVotes([
        ['A', 'B', 'C', 'D', 'E'],
        ['B', 'C', 'A', 'D', 'E'],
        ['C', 'A', 'B', 'D', 'E']
      ])
      .run()
    console.log('WINNER:', result.winner)
    console.log('ROUNDS:', JSON.stringify(result.rounds, null, 2))
  })
})