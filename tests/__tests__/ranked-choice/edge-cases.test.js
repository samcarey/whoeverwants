import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { ensureMigrationsApplied, cleanupTestPolls } from '../../helpers/database.js'

describe('Edge Cases and Boundary Conditions', () => {
  beforeAll(async () => {
    await ensureMigrationsApplied()
    await cleanupTestPolls()
  })

  describe('Empty and Minimal Votes', () => {
    it('handles poll with no votes', async () => {
      const result = await createPoll(['A', 'B', 'C'])
        .withVotes([])
        .expectWinner(null)
        .run()

      // Should handle gracefully with null winner
      expect(result.winner).toBeNull()
    })

    it('handles single vote scenario', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C']  // A gets 1 vote = 100% majority
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, wins majority (100%)
            ['B', 0, false],  
            ['C', 0, false]   
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('handles two candidates with one vote each', async () => {
      await createPoll(['A', 'B'])
        .withVotes([
          ['A', 'B'],  // A=1, B gets 1 Borda point
          ['B', 'A']   // B=1, A gets 1 Borda point - perfect Borda tie
        ])
        .expectRounds([
          { round: 1, results: [
            ['B', 1, false],  // B survives (alphabetical tiebreaker)
            ['A', 1, true]    // A eliminated first (alphabetical when Borda tied)
          ]},
          { round: 2, results: [
            ['B', 2, false]   // B gets A's transfer, wins
          ]}
        ])
        .expectWinner('B')
        .run()
    })
  })

  describe('Incomplete and Invalid Ballots', () => {
    it('handles ballots with only one candidate ranked', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A'],           // Only A ranked - A=3pts, B=0pts, C=0pts
          ['B', 'A'],      // B first, A second - B=3pts, A=2pts, C=0pts  
          ['C', 'B', 'A']  // All ranked - C=3pts, B=2pts, A=1pt
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, 6 Borda points, survives
            ['B', 1, false],  // B: 1 vote, 5 Borda points, survives
            ['C', 1, true]    // C: 1 vote, 3 Borda points, eliminated (lowest Borda)
          ]},
          { round: 2, results: [
            ['B', 2, false],  // B: gets C's transfer, wins
            ['A', 1, false]   
          ]}
        ])
        .expectWinner('B')
        .run()
    })

    it('handles mixed complete and incomplete ballots', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B'],         // A first, B second, C&D unranked
          ['A', 'C', 'D'],    // A first, C second, D third, B unranked
          ['B', 'A'],         // B first, A second, C&D unranked  
          ['C']               // Only C ranked
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives (7 Borda points)
            ['C', 1, false],  // C: 1 vote, survives (7 Borda points)
            ['D', 0, true]    // D: 0 votes, eliminated (2 Borda points)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, no transfers from D
            ['C', 1, false],  // C: 1 vote, survives
            ['B', 1, true]    // B: eliminated (Borda tie with C, alphabetical first)
          ]},
          { round: 3, results: [
            ['A', 3, false],  // A: gets B's transfer, wins
            ['C', 1, false]   
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Large Number of Candidates', () => {
    it('handles many candidates with systematic elimination', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E', 'F', 'G'],  // A=2
          ['A', 'C', 'B', 'D', 'E', 'F', 'G'],  
          ['B', 'A', 'C', 'D', 'E', 'F', 'G'],  // B=1
          ['C', 'B', 'A', 'D', 'E', 'F', 'G']   // C=1, D=0, E=0, F=0, G=0
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, false],  // D: 0 votes, survives (16 Borda points)
            ['E', 0, false],  // E: 0 votes, survives (12 Borda points)
            ['F', 0, false],  // F: 0 votes, survives (8 Borda points)
            ['G', 0, true]    // G: 0 votes, eliminated (4 Borda points - lowest)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives  
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, false],  // D: 0 votes, survives
            ['E', 0, false],  // E: 0 votes, survives
            ['F', 0, true]    // F: eliminated next (8 Borda points)
          ]},
          { round: 3, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives  
            ['D', 0, false],  // D: 0 votes, survives
            ['E', 0, true]    // E: eliminated next (12 Borda points)
          ]},
          { round: 4, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, true]    // D: eliminated next (16 Borda points)
          ]},
          { round: 5, results: [
            ['A', 2, false],  // A: 2 votes, survives  
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, true]    // C: eliminated (23 Borda points vs B's 24)
          ]},
          { round: 6, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 2, true]    // B: gets C's transfer but still eliminated
          ]},
          { round: 7, results: [
            ['A', 4, false]   // A: gets all remaining votes, wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Unusual Voting Patterns', () => {
    it('handles reverse-order voting patterns', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],  // A=1, Borda: A=3, B=2, C=1  
          ['C', 'B', 'A'],  // C=1, Borda: C=3, B=2, A=1
          ['B', 'A', 'C']   // B=1, Borda: B=3, A=2, C=1
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, 6 Borda points, survives
            ['B', 1, false],  // B: 1 vote, 7 Borda points, survives
            ['C', 1, true]    // C: 1 vote, 5 Borda points, eliminated (lowest)
          ]},
          { round: 2, results: [
            ['B', 2, false],  // B: gets C's transfer, wins
            ['A', 1, false]   
          ]}
        ])
        .expectWinner('B')
        .run()
    })

    it('handles strategic voting attempts', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'D', 'C', 'B'],  // A first, skip B to last
          ['A', 'D', 'C', 'B'],  // Same strategy
          ['B', 'C', 'D', 'A'],  // B voters counter-strategy
          ['C', 'A', 'B', 'D']   // C tries to win
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives  
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, true]    // D: 0 votes, eliminated (lowest Borda score)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, no transfers from D
            ['C', 1, false],  // C: 1 vote, survives
            ['B', 1, true]    // B: eliminated by Borda count (B vs C tie)
          ]},
          { round: 3, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['C', 2, true]    // C: gets B's transfer but eliminated 
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Boundary Conditions', () => {
    it('handles exactly 50-50 split requiring runoff', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'C', 'B'],  // A=2 (50% but not majority)
          ['A', 'B', 'C'],  
          ['B', 'C', 'A'],  // B=2 (50% but not majority)
          ['B', 'A', 'C']   // C=0
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes (50%), survives
            ['B', 2, false],  // B: 2 votes (50%), survives
            ['C', 0, true]    // C: 0 votes, eliminated
          ]},
          { round: 2, results: [
            ['B', 2, false],  // B: 2 votes, survives
            ['A', 2, true]    // A: eliminated (alphabetical when Borda tied)
          ]},
          { round: 3, results: [
            ['B', 4, false]   // B: gets A's transfer, wins
          ]}
        ])
        .expectWinner('B')
        .run()
    })
  })
})