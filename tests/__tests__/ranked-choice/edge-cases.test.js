import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { isApiAvailable } from '../../helpers/database.js'

let apiUp = false

beforeAll(async () => {
  apiUp = await isApiAvailable()
})

describe('Edge Cases and Boundary Conditions', () => {
  describe('Empty and Minimal Votes', () => {
    it('handles poll with no votes', async ({ skip }) => {
      if (!apiUp) skip()
      const result = await createPoll(['A', 'B', 'C'])
        .withVotes([])
        .expectWinner(null)
        .run()
      expect(result.winner).toBeNull()
    })

    it('handles single vote scenario', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([['A', 'B', 'C']])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 0, false],
            ['C', 0, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('handles two candidates with one vote each', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B'])
        .withVotes([['A', 'B'], ['B', 'A']])
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

  describe('Incomplete and Invalid Ballots', () => {
    it('handles ballots with only one candidate ranked', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A'],
          ['B', 'A'],
          ['C', 'B', 'A']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['B', 1, false],
            ['C', 1, true]
          ]},
          { round: 2, results: [
            ['B', 2, false],
            ['A', 1, false]
          ]}
        ])
        .expectWinner('B')
        .run()
    })

    it('handles mixed complete and incomplete ballots', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B'],
          ['A', 'C', 'D'],
          ['B', 'A'],
          ['C']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 0, true]
          ]},
          { round: 2, results: [
            ['A', 2, false],
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

  describe('Large Number of Candidates', () => {
    it('handles many candidates with systematic elimination', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
          ['A', 'C', 'B', 'D', 'E', 'F', 'G'],
          ['B', 'A', 'C', 'D', 'E', 'F', 'G'],
          ['C', 'B', 'A', 'D', 'E', 'F', 'G']
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Unusual Voting Patterns', () => {
    it('handles reverse-order voting patterns', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],
          ['C', 'B', 'A'],
          ['B', 'A', 'C']
        ])
        .expectWinner('B')
        .run()
    })

    it('handles strategic voting attempts', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'D', 'C', 'B'],
          ['A', 'D', 'C', 'B'],
          ['B', 'C', 'D', 'A'],
          ['C', 'A', 'B', 'D']
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Boundary Conditions', () => {
    it('handles exactly 50-50 split requiring runoff', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'C', 'B'],
          ['A', 'B', 'C'],
          ['B', 'C', 'A'],
          ['B', 'A', 'C']
        ])
        .expectWinner('A')
        .run()
    })
  })
})
