import { describe, it, beforeAll } from 'vitest'
import { createQuestion } from '../../helpers/question-builder.js'
import { isApiAvailable } from '../../helpers/database.js'

let apiUp = false

beforeAll(async () => {
  apiUp = await isApiAvailable()
})

describe('Borda Count Tie-Breaking', () => {
  describe('Classic Borda Count Scenarios', () => {
    it('eliminates candidate with lowest Borda score when tied for last place', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'D', 'B'],
          ['B', 'C', 'A', 'D'],
          ['C', 'A', 'B', 'D'],
          ['D', 'A', 'C', 'B']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, true]
          ]},
          { round: 2, results: [
            ['A', 2, false],
            ['B', 1, true],
            ['C', 1, false]
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

    it('uses Borda count to determine which candidate survives comeback scenario', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],
          ['A', 'C', 'B', 'D', 'E'],
          ['B', 'C', 'A', 'D', 'E'],
          ['C', 'B', 'A', 'D', 'E'],
          ['D', 'C', 'B', 'A', 'E']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, false],
            ['E', 0, true]
          ]},
          { round: 2, results: [
            ['A', 2, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, true]
          ]},
          { round: 3, results: [
            ['A', 2, false],
            ['C', 2, false],
            ['B', 1, true]
          ]},
          { round: 4, results: [
            ['C', 3, false],
            ['A', 2, false]
          ]}
        ])
        .expectWinner('C')
        .run()
    })

    it('handles Borda count when some candidates not ranked by all voters', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, true]
          ]},
          { round: 2, results: [
            ['A', 2, false],
            ['B', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Zero Vote Candidates with Borda Scoring', () => {
    it('uses Borda scores to eliminate among zero-vote candidates', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'D', 'B'],
          ['A', 'D', 'C', 'B'],
          ['A', 'C', 'B', 'D']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 3, false],
            ['B', 0, false],
            ['C', 0, false],
            ['D', 0, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates candidate with lowest Borda among multiple zero-vote candidates', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],
          ['B', 'C', 'A', 'D', 'E'],
          ['C', 'A', 'B', 'D', 'E']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 0, false],
            ['E', 0, true]
          ]},
          { round: 2, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 0, true]
          ]},
          { round: 3, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, true]
          ]},
          { round: 4, results: [
            ['A', 2, false],
            ['B', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Complex Multi-Round Borda Scenarios', () => {
    it('applies Borda count repeatedly across multiple rounds', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B', 'C', 'D', 'E', 'F'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E', 'F'],
          ['A', 'C', 'B', 'D', 'E', 'F'],
          ['B', 'A', 'C', 'D', 'E', 'F'],
          ['C', 'A', 'B', 'D', 'E', 'F'],
          ['D', 'A', 'B', 'C', 'E', 'F'],
          ['E', 'A', 'B', 'C', 'D', 'F']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, false],
            ['E', 1, false],
            ['F', 0, true]
          ]},
          { round: 2, results: [
            ['A', 2, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, false],
            ['E', 1, true]
          ]},
          { round: 3, results: [
            ['A', 3, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, true]
          ]},
          { round: 4, results: [
            ['A', 4, false],
            ['B', 1, false],
            ['C', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Deterministic Tie-Breaking', () => {
    it('uses alphabetical sorting as secondary sort when Borda scores are identical', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],
          ['B', 'A', 'C'],
          ['C', 'A', 'B']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, true]
          ]},
          { round: 2, results: [
            ['A', 2, false],
            ['B', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('handles perfect Borda ties with alphabetical elimination', async ({ skip }) => {
      if (!apiUp) skip()
      await createQuestion(['A', 'B'])
        .withVotes([
          ['A', 'B'],
          ['B', 'A']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, true]
          ]},
          { round: 2, results: [
            ['A', 2, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })
})
