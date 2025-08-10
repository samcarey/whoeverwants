import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { ensureMigrationsApplied, cleanupTestPolls } from '../../helpers/database.js'

describe('Borda Count Tie Breaking - Updated for New Algorithm', () => {
  beforeAll(async () => {
    await ensureMigrationsApplied()
    await cleanupTestPolls()
  })

  describe('Borda Count vs Old Batch Elimination', () => {
    it('uses Borda count to eliminate single candidate instead of all tied candidates', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],  // A=1, B gets 2 pts, C gets 1 pt  
          ['B', 'A', 'C'],  // B=1, A gets 2 pts, C gets 1 pt
          ['C', 'A', 'B']   // C=1, A gets 2 pts, B gets 1 pt
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, 4 Borda points, survives
            ['B', 1, false],  // B: 1 vote, 3 Borda points, survives  
            ['C', 1, true]    // C: 1 vote, 2 Borda points, eliminated by Borda count
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: gets C's transfer, wins
            ['B', 1, false]   
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates candidate with lowest Borda score from tied group', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'D', 'B'],  // A=1, C=3pts, D=2pts, B=1pt
          ['B', 'C', 'A', 'D'],  // B=1, C=3pts, A=2pts, D=1pt  
          ['C', 'A', 'B', 'D'],  // C=1, A=3pts, B=2pts, D=1pt
          ['D', 'A', 'C', 'B']   // D=1, A=3pts, C=2pts, B=1pt
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, 12 Borda points, survives
            ['C', 1, false],  // C: 1 vote, 12 Borda points, survives
            ['D', 1, false],  // D: 1 vote, 8 Borda points, survives
            ['B', 1, true]    // B: 1 vote, 8 Borda points, eliminated (tied with D, alphabetically first)
          ]},
          { round: 2, results: [
            ['C', 2, false],  // C: gets B's transfer, no majority yet
            ['A', 1, false],  
            ['D', 1, true]    // D: eliminated next by Borda
          ]},
          { round: 3, results: [
            ['C', 2, false],  // C: still leading
            ['A', 2, true]    // A: gets D's transfer, but C wins by elimination
          ]},
          { round: 4, results: [
            ['C', 4, false]   // C: gets all remaining votes, wins
          ]}
        ])
        .expectWinner('C')
        .run()
    })

    it('handles perfect Borda score ties with alphabetical elimination', async () => {
      await createPoll(['A', 'B'])
        .withVotes([
          ['A', 'B'],  // A=1, B gets 1 Borda point
          ['B', 'A']   // B=1, A gets 1 Borda point  
        ])
        .expectRounds([
          { round: 1, results: [
            ['B', 1, false],  // B: 1 vote, survives
            ['A', 1, true]    // A: 1 vote, eliminated (alphabetical when Borda tied)
          ]},
          { round: 2, results: [
            ['B', 2, false]   // B: gets A's transfer, wins
          ]}
        ])
        .expectWinner('B')
        .run()
    })
  })

  describe('Complex Multi-Round Borda Scenarios', () => {
    it('applies Borda count in each round separately', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],  // A=2
          ['A', 'C', 'B', 'D', 'E'],  
          ['B', 'A', 'C', 'D', 'E'],  // B=1
          ['C', 'A', 'B', 'D', 'E'],  // C=1
          ['D', 'A', 'B', 'C', 'E']   // D=1, E=0
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives (higher Borda than E)
            ['C', 1, false],  // C: 1 vote, survives (higher Borda than E)  
            ['D', 1, false],  // D: 1 vote, survives (higher Borda than E)
            ['E', 0, true]    // E: 0 votes, eliminated (lowest Borda)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, no majority yet (need 3/5)
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives 
            ['D', 1, true]    // D: eliminated by Borda count (lowest score)
          ]},
          { round: 3, results: [
            ['A', 3, false],  // A: gets D's transfer, wins majority
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false]   // C: 1 vote, survives
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('continues eliminating until clear winner emerges', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'D', 'B'],  // A=1
          ['B', 'D', 'A', 'C'],  // B=1
          ['C', 'A', 'B', 'D'],  // C=1
          ['D', 'B', 'C', 'A']   // D=1 - all tied at 1 vote
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, true],   // A: 1 vote, eliminated (alphabetical when Borda tied)
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, false]   // D: 1 vote, survives
          ]},
          { round: 2, results: [
            ['C', 2, false],  // C: gets A's transfer, survives
            ['D', 1, false],  // D: 1 vote, survives
            ['B', 1, true]    // B: eliminated next
          ]},
          { round: 3, results: [
            ['D', 2, false],  // D: gets B's transfer, survives
            ['C', 2, true]    // C: eliminated (Borda tiebreaker)
          ]},
          { round: 4, results: [
            ['D', 4, false]   // D: gets all transfers, wins
          ]}
        ])
        .expectWinner('D')
        .run()
    })
  })

  describe('Zero Vote Candidate Scenarios', () => {
    it('uses Borda count even among zero-vote candidates', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],  // A=2, others get various Borda scores
          ['A', 'C', 'D', 'B']   
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, wins majority (100%)
            ['B', 0, false],  // B: 0 votes (would be eliminated if no majority)
            ['C', 0, false],  // C: 0 votes (would be eliminated if no majority)
            ['D', 0, false]   // D: 0 votes (would be eliminated if no majority)
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates zero-vote candidate with lowest Borda score', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],  // A=1
          ['B', 'C', 'A', 'D'],  // B=1, C=0, D=0
          ['C', 'A', 'B', 'D']   // C=1, D=0
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['B', 1, false],  // B: 1 vote, survives  
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, true]    // D: 0 votes, eliminated (lowest Borda score)
          ]},
          { round: 2, results: [
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['A', 1, true]    // A: 1 vote, eliminated (alphabetical when Borda tied)
          ]},
          { round: 3, results: [
            ['B', 2, false],  // B: gets A's transfer, wins
            ['C', 1, false]   // C: 1 vote, survives
          ]}
        ])
        .expectWinner('B')
        .run()
    })
  })
})