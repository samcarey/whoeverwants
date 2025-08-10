import { describe, it, beforeAll } from 'vitest'
import { createPoll, votePatterns } from '../../helpers/poll-builder.js'
import { ensureMigrationsApplied, cleanupTestPolls } from '../../helpers/database.js'

describe('Zero Vote Elimination Bug Fix', () => {
  beforeAll(async () => {
    await ensureMigrationsApplied()
    await cleanupTestPolls()
  })

  describe('Original Production Bug Scenario', () => {
    it('eliminates B and C with 0 first-place votes before A, D, E with 1 vote each', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'D', 'B', 'C', 'E'],  // A first
          ['E', 'A', 'B', 'C', 'D'],  // E first  
          ['D', 'E', 'A', 'B', 'C']   // D first
        ])
        .expectRounds([
          { round: 1, results: [
            ['D', 1, false],  // D: 1 vote, survives
            ['E', 1, false],  // E: 1 vote, survives
            ['A', 1, false],  // A: 1 vote, survives
            ['C', 0, true],   // C: 0 votes, eliminated (lowest Borda score)
            ['B', 0, false]   // B: 0 votes, survives (higher Borda than C)
          ]},
          { round: 2, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['E', 1, false],  // E: 1 vote, survives
            ['D', 1, false],  // D: 1 vote, survives
            ['B', 0, true]    // B: 0 votes, eliminated (lowest Borda score)
          ]},
          { round: 3, results: [
            ['E', 1, false],  // E: 1 vote, survives
            ['A', 1, false],  // A: 1 vote, survives
            ['D', 1, true]    // D: 1 vote, eliminated (Borda tiebreaker)
          ]},
          { round: 4, results: [
            ['E', 2, false],  // E: gets D's transfer, wins
            ['A', 1, false]   // A: 1 vote, survives
          ]}
        ])
        .expectWinner('E')
        .run()
    })

    it('eliminates single candidate with 0 votes when others are tied with 1', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'C', 'B'],  // A first
          ['C', 'A', 'B']   // C first, B has 0 votes
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives  
            ['B', 0, true]    // B: 0 votes, eliminated first
          ]},
          { round: 2, results: [
            ['C', 1, false],  // C: 1 vote, survives
            ['A', 1, true]    // A: eliminated (alphabetical tiebreaker)
          ]},
          { round: 3, results: [
            ['C', 2, false]   // C: gets A's transfer, wins
          ]}
        ])
        .expectWinner('C')
        .run()
    })
  })

  describe('Multiple Zero Vote Scenarios', () => {
    it('eliminates all candidates with 0 votes when clear winner exists', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],  // A first
          ['A', 'C', 'D', 'B'],  // A first
          ['A', 'D', 'B', 'C']   // A first - A has majority
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 3, false],  // A: 3 votes, wins immediately
            ['B', 0, false],  // B: 0 votes but winner declared
            ['C', 0, false],  // C: 0 votes but winner declared
            ['D', 0, false]   // D: 0 votes but winner declared
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates candidates with 0 votes in correct order when multiple rounds needed', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],  // A=1
          ['C', 'A', 'B', 'D', 'E'],  // C=1  
          ['D', 'A', 'C', 'B', 'E'],  // D=1
          ['E', 'C', 'A', 'B', 'D']   // E=1, B=0 first place
        ])
        .expectRounds([
          { round: 1, results: [
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, false],  // D: 1 vote, survives
            ['A', 1, false],  // A: 1 vote, survives
            ['E', 1, false],  // E: 1 vote, survives
            ['B', 0, true]    // B: 0 votes, eliminated first (lowest Borda)
          ]},
          { round: 2, results: [
            ['D', 1, false],  // D: 1 vote, survives
            ['A', 1, false],  // A: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['E', 1, true]    // E: eliminated (lowest Borda among remaining)
          ]},
          { round: 3, results: [
            ['C', 2, false],  // C: gets E's transfer, survives
            ['A', 1, false],  // A: 1 vote, survives
            ['D', 1, true]    // D: eliminated (lowest Borda)
          ]},
          { round: 4, results: [
            ['A', 2, false],  // A: gets D's transfer, survives
            ['C', 2, true]    // C: eliminated (Borda tiebreaker)
          ]},
          { round: 5, results: [
            ['A', 4, false]   // A: gets all transfers, wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Edge Cases', () => {
    it('handles single voter with some candidates getting 0 votes', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C']  // Only A gets a vote
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, wins majority
            ['B', 0, false],  // B: 0 votes
            ['C', 0, false]   // C: 0 votes
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates candidates with partial rankings and 0 first-place votes', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B'],        // A=1, B second, C and D unranked
          ['C', 'D', 'A'],   // C=1, D second, A third, B unranked
          ['D', 'A', 'C'],   // D=1, A second, C third, B unranked  
          ['A', 'C', 'D']    // A=2, C second, D third, B unranked
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives (no majority with 4 votes)
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, false],  // D: 1 vote, survives
            ['B', 0, true]    // B: 0 votes, eliminated (never ranked first)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, survives 
            ['D', 1, false],  // D: 1 vote, survives
            ['C', 1, true]    // C: eliminated (Borda tiebreaker)
          ]},
          { round: 3, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['D', 2, true]    // D: gets C's transfer but eliminated
          ]},
          { round: 4, results: [
            ['A', 4, false]   // A: gets all remaining transfers, wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })
})