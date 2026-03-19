import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { isApiAvailable } from '../../helpers/database.js'

let apiUp = false

beforeAll(async () => {
  apiUp = await isApiAvailable()
})

describe('Zero Vote Elimination Bug Fix', () => {
  describe('Original Production Bug Scenario', () => {
    it('eliminates candidates with 0 votes before those with 1 vote', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'D', 'B', 'C', 'E'],
          ['E', 'A', 'B', 'C', 'D'],
          ['D', 'E', 'A', 'B', 'C']
        ])
        .expectRounds([
          { round: 1, results: [
            ['D', 1, false],
            ['E', 1, false],
            ['A', 1, false],
            ['C', 0, true],
            ['B', 0, false]
          ]},
          { round: 2, results: [
            ['A', 1, false],
            ['E', 1, false],
            ['D', 1, false],
            ['B', 0, true]
          ]},
          { round: 3, results: [
            ['E', 1, true],
            ['D', 1, false],
            ['A', 1, false]
          ]},
          { round: 4, results: [
            ['A', 2, false],
            ['D', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates single candidate with 0 votes when others are tied', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'C', 'B'],
          ['C', 'A', 'B']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['C', 1, false],
            ['B', 0, true]
          ]},
          { round: 2, results: [
            ['C', 1, true],
            ['A', 1, false]
          ]},
          { round: 3, results: [
            ['A', 2, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Multiple Zero Vote Scenarios', () => {
    it('declares winner immediately when one candidate has all votes', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],
          ['A', 'C', 'D', 'B'],
          ['A', 'D', 'B', 'C']
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

    it('eliminates zero-vote candidates in correct order over multiple rounds', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],
          ['C', 'A', 'B', 'D', 'E'],
          ['D', 'A', 'C', 'B', 'E'],
          ['E', 'C', 'A', 'B', 'D']
        ])
        .expectRounds([
          { round: 1, results: [
            ['C', 1, false],
            ['D', 1, false],
            ['A', 1, false],
            ['E', 1, false],
            ['B', 0, true]
          ]},
          { round: 2, results: [
            ['A', 1, false],
            ['C', 1, false],
            ['D', 1, false],
            ['E', 1, true]
          ]},
          { round: 3, results: [
            ['A', 1, false],
            ['C', 2, false],
            ['D', 1, true]
          ]},
          { round: 4, results: [
            ['C', 2, true],
            ['A', 2, false]
          ]},
          { round: 5, results: [
            ['A', 4, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Edge Cases', () => {
    it('handles single voter with some candidates getting 0 votes', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C']
        ])
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

    it('handles partial rankings with zero first-place votes', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B'],
          ['C', 'D', 'A'],
          ['D', 'A', 'C'],
          ['A', 'C', 'D']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],
            ['C', 1, false],
            ['D', 1, false],
            ['B', 0, true]
          ]},
          { round: 2, results: [
            ['A', 2, false],
            ['C', 1, false],
            ['D', 1, true]
          ]},
          { round: 3, results: [
            ['A', 3, false],
            ['C', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })
})
