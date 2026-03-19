import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { isApiAvailable } from '../../helpers/database.js'

let apiUp = false

beforeAll(async () => {
  apiUp = await isApiAvailable()
})

describe('Borda Count Tie Breaking - Updated for New Algorithm', () => {
  describe('Borda Count vs Old Batch Elimination', () => {
    it('uses Borda count to eliminate single candidate instead of all tied candidates', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
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

    it('eliminates candidate with lowest Borda score from tied group', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
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

    it('handles perfect Borda score ties with alphabetical elimination', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B'])
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

  describe('Complex Multi-Round Borda Scenarios', () => {
    it('applies Borda count in each round separately', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],
          ['A', 'C', 'B', 'D', 'E'],
          ['B', 'A', 'C', 'D', 'E'],
          ['C', 'A', 'B', 'D', 'E'],
          ['D', 'A', 'B', 'C', 'E']
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
            ['A', 3, false],
            ['B', 1, false],
            ['C', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('continues eliminating until clear winner emerges', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'D', 'B'],
          ['B', 'D', 'A', 'C'],
          ['C', 'A', 'B', 'D'],
          ['D', 'B', 'C', 'A']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, true]
          ]},
          { round: 2, results: [
            ['B', 2, false],
            ['A', 1, false],
            ['C', 1, true]
          ]},
          { round: 3, results: [
            ['A', 2, false],
            ['B', 2, true]
          ]},
          { round: 4, results: [
            ['A', 4, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Zero Vote Candidate Scenarios', () => {
    it('uses Borda count even among zero-vote candidates', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],
          ['A', 'C', 'D', 'B']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],
            ['B', 0, false],
            ['C', 0, false],
            ['D', 0, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates zero-vote candidate with lowest Borda score', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],
          ['B', 'C', 'A', 'D'],
          ['C', 'A', 'B', 'D']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 0, true]
          ]},
          { round: 2, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, true]
          ]},
          { round: 3, results: [
            ['A', 2, false],
            ['B', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })
})
