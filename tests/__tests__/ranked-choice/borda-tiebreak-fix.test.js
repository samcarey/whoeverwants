import { describe, it, beforeAll } from 'vitest'
import { createQuestion } from '../../helpers/question-builder.js'
import { isApiAvailable } from '../../helpers/database.js'

let apiUp = false

beforeAll(async () => {
  apiUp = await isApiAvailable()
})

describe('Borda Count Tie-Breaking Fix', () => {
  it('should eliminate A (lowest Borda) when A and C have same votes but B has higher Borda score', async ({ skip }) => {
    if (!apiUp) skip()
    await createQuestion(['A', 'B', 'C'])
      .withVotes([
        ['A', 'B', 'C'],
        ['C', 'B', 'A'],
        ['B', 'C', 'A']
      ])
      // Vote counts: A=1, B=1, C=1 (all tied)
      // Borda scores: A=3+1+1=5, B=2+2+3=7, C=1+2+2=5 → actually B=7, C=1+3+2=6, A=3+1+1=5
      // A has lowest Borda, gets eliminated
      .expectRounds([
        { round: 1, results: [
          ['A', 1, true],
          ['B', 1, false],
          ['C', 1, false]
        ]},
        { round: 2, results: [
          ['B', 2, false],
          ['C', 1, false]
        ]}
      ])
      .expectWinner('B')
      .run()
  })

  it('should handle multiple candidates tied for lowest Borda score', async ({ skip }) => {
    if (!apiUp) skip()
    await createQuestion(['A', 'B', 'C', 'D'])
      .withVotes([
        ['A', 'B', 'C', 'D'],
        ['D', 'C', 'B', 'A'],
        ['B', 'A', 'D', 'C'],
        ['C', 'D', 'A', 'B']
      ])
      // All tied at 1 vote and 10 Borda points each → eliminate D (alphabetically last)
      .expectRounds([
        { round: 1, results: [
          ['A', 1, false],
          ['B', 1, false],
          ['C', 1, false],
          ['D', 1, true]
        ]},
        { round: 2, results: [
          ['C', 2, false],
          ['A', 1, false],
          ['B', 1, true]
        ]},
        { round: 3, results: [
          ['A', 2, false],
          ['C', 2, true]
        ]},
        { round: 4, results: [
          ['A', 4, false]
        ]}
      ])
      .expectWinner('A')
      .run()
  })

  it('should only consider lowest Borda score candidates for alphabetical elimination', async ({ skip }) => {
    if (!apiUp) skip()
    await createQuestion(['A', 'B', 'C', 'D'])
      .withVotes([
        ['A', 'B', 'D', 'C'],
        ['B', 'A', 'D', 'C'],
        ['C', 'D', 'A', 'B'],
        ['D', 'C', 'A', 'B']
      ])
      // A=11 Borda, D=11 Borda (highest), B=9, C=9 (lowest) → eliminate C
      .expectRounds([
        { round: 1, results: [
          ['A', 1, false],
          ['B', 1, false],
          ['C', 1, true],
          ['D', 1, false]
        ]},
        { round: 2, results: [
          ['D', 2, false],
          ['A', 1, false],
          ['B', 1, true]
        ]},
        { round: 3, results: [
          ['A', 2, false],
          ['D', 2, true]
        ]},
        { round: 4, results: [
          ['A', 4, false]
        ]}
      ])
      .expectWinner('A')
      .run()
  })
})
