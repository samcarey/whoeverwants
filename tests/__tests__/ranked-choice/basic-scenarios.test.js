import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { isApiAvailable } from '../../helpers/database.js'

let apiUp = false

beforeAll(async () => {
  apiUp = await isApiAvailable()
})

describe('Basic Ranked Choice Voting Scenarios', () => {
  describe('Immediate Winners', () => {
    it('declares winner immediately when candidate has majority in first round', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],
          ['A', 'C', 'B'],
          ['A', 'B', 'C'],
          ['B', 'A', 'C'],
          ['C', 'A', 'B']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 3, false],
            ['B', 1, false],
            ['C', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('continues to elimination when no candidate has majority', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],
          ['A', 'C', 'B'],
          ['B', 'A', 'C'],
          ['C', 'A', 'B'],
          ['C', 'B', 'A']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],
            ['C', 2, false],
            ['B', 1, true]
          ]},
          { round: 2, results: [
            ['A', 3, false],
            ['C', 2, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Sequential Elimination', () => {
    it('eliminates candidates one by one until winner emerges', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],
          ['A', 'C', 'B', 'D'],
          ['B', 'A', 'C', 'D'],
          ['C', 'B', 'A', 'D'],
          ['D', 'A', 'B', 'C']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],
            ['B', 1, false],
            ['C', 1, false],
            ['D', 1, true]
          ]},
          { round: 2, results: [
            ['A', 3, false],
            ['B', 1, false],
            ['C', 1, false]
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('handles complex vote redistribution across multiple rounds', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'D', 'B', 'C'],
          ['B', 'D', 'A', 'C'],
          ['C', 'D', 'A', 'B'],
          ['D', 'A', 'B', 'C'],
          ['D', 'B', 'A', 'C'],
          ['D', 'C', 'B', 'A']
        ])
        .expectRounds([
          { round: 1, results: [
            ['D', 3, false],
            ['B', 1, false],
            ['A', 1, false],
            ['C', 1, true]
          ]},
          { round: 2, results: [
            ['D', 4, false],
            ['A', 1, false],
            ['B', 1, false]
          ]}
        ])
        .expectWinner('D')
        .run()
    })
  })

  describe('Vote Transfer Logic', () => {
    it('transfers votes correctly when preferred candidate is eliminated', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],
          ['B', 'C', 'A'],
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

    it('skips eliminated candidates when transferring votes', async ({ skip }) => {
      if (!apiUp) skip()
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],
          ['C', 'A', 'B', 'D'],
          ['D', 'C', 'A', 'B']
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],
            ['C', 1, false],
            ['D', 1, false],
            ['B', 0, true]
          ]},
          { round: 2, results: [
            ['A', 1, false],
            ['C', 1, false],
            ['D', 1, true]
          ]},
          { round: 3, results: [
            ['C', 2, false],
            ['A', 1, false]
          ]}
        ])
        .expectWinner('C')
        .run()
    })
  })
})
