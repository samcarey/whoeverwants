import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { ensureMigrationsApplied, cleanupTestPolls } from '../../helpers/database.js'

describe('Borda Count Tie-Breaking', () => {
  beforeAll(async () => {
    await ensureMigrationsApplied()
    await cleanupTestPolls()
  })

  describe('Classic Borda Count Scenarios', () => {
    it('eliminates candidate with lowest Borda score when tied for last place', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'D', 'B'],  // A=1, C gets 2nd choice (3 pts), D gets 3rd choice (2 pts), B gets 4th choice (1 pt)
          ['B', 'C', 'A', 'D'],  // B=1, C gets 2nd choice (3 pts), A gets 3rd choice (2 pts), D gets 4th choice (1 pt)
          ['C', 'A', 'B', 'D'],  // C=1, A gets 2nd choice (3 pts), B gets 3rd choice (2 pts), D gets 4th choice (1 pt)
          ['D', 'A', 'C', 'B']   // D=1, A gets 2nd choice (3 pts), C gets 3rd choice (2 pts), B gets 4th choice (1 pt)
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, 12 Borda points, survives
            ['B', 1, false],  // B: 1 vote, 8 Borda points, survives
            ['C', 1, false],  // C: 1 vote, 12 Borda points, survives
            ['D', 1, true]    // D: 1 vote, 8 Borda points, eliminated (B vs D tie, D alphabetically last)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: gets D's transfer, survives
            ['B', 1, true],   // B: eliminated (alphabetically last when B,C tied)
            ['C', 1, false]   // C: 1 vote, survives
          ]},
          { round: 3, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['C', 2, true]    // C: gets B's transfer but eliminated (alphabetically last when tied)
          ]},
          { round: 4, results: [
            ['A', 4, false]   // A: gets C's transfer, wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('uses Borda count to determine which candidate survives comeback scenario', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],  // A=2 first place votes
          ['A', 'C', 'B', 'D', 'E'],  
          ['B', 'C', 'A', 'D', 'E'],  // B=1
          ['C', 'B', 'A', 'D', 'E'],  // C=1  
          ['D', 'C', 'B', 'A', 'E']   // D=1, E=0 (tied for last: D and E)
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives  
            ['D', 1, false],  // D: 1 vote, survives
            ['E', 0, true]    // E: 0 votes, eliminated (lowest Borda score)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, true]    // D: eliminated (alphabetically last when tied)
          ]},
          { round: 3, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['C', 2, false],  // C: gets D's transfer, survives
            ['B', 1, true]    // B: eliminated (alphabetically last)
          ]},
          { round: 4, results: [
            ['C', 3, false],  // C: gets B's transfer, wins
            ['A', 2, false]   // A: 2 votes, survives
          ]}
        ])
        .expectWinner('C')
        .run()
    })

    it('handles Borda count when some candidates not ranked by all voters', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B'],        // A=1, B gets 2 points, C gets 0 points (unranked)
          ['B', 'C'],        // B=1, C gets 2 points, A gets 0 points (unranked)  
          ['C', 'A']         // C=1, A gets 2 points, B gets 0 points (unranked)
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, true]    // C: eliminated first (alphabetically last when Borda tied at 5 points each)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: gets C's transfer, wins
            ['B', 1, false]   // B: 1 vote, survives
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Zero Vote Candidates with Borda Scoring', () => {
    it('uses Borda scores to eliminate among zero-vote candidates', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'D', 'B'],  // A=3, others get Borda points
          ['A', 'D', 'C', 'B'],  
          ['A', 'C', 'B', 'D']   
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 3, false],  // A: 3 votes, wins majority
            ['B', 0, false],  // B: 0 votes (would be eliminated if no majority)
            ['C', 0, false],  // C: 0 votes (would be eliminated if no majority)
            ['D', 0, false]   // D: 0 votes (would be eliminated if no majority)
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('eliminates candidate with lowest Borda among multiple zero-vote candidates', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],  // A=1
          ['B', 'C', 'A', 'D', 'E'],  // B=1, C,D,E get 0 first-place votes
          ['C', 'A', 'B', 'D', 'E']   // C=1, B,D,E get 0 first-place votes
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives  
            ['D', 0, false],  // D: 0 votes, survives
            ['E', 0, true]    // E: 0 votes, eliminated (lowest Borda score)
          ]},
          { round: 2, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, true]    // D: 0 votes, eliminated
          ]},
          { round: 3, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, true]    // C: eliminated (alphabetically last when Borda tied)
          ]},
          { round: 4, results: [
            ['A', 2, false],  // A: gets C's transfer, wins
            ['B', 1, false]   // B: 1 vote, survives but A wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Complex Multi-Round Borda Scenarios', () => {
    it('applies Borda count repeatedly across multiple rounds', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E', 'F'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E', 'F'],  // A=2
          ['A', 'C', 'B', 'D', 'E', 'F'],  
          ['B', 'A', 'C', 'D', 'E', 'F'],  // B=1
          ['C', 'A', 'B', 'D', 'E', 'F'],  // C=1
          ['D', 'A', 'B', 'C', 'E', 'F'],  // D=1, E=0, F=0 (tied for last)
          ['E', 'A', 'B', 'C', 'D', 'F']   // E=1, F=0
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, false],  // D: 1 vote, survives  
            ['E', 1, false],  // E: 1 vote, survives
            ['F', 0, true]    // F: 0 votes, eliminated (lowest Borda)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, false],  // D: 1 vote, survives
            ['E', 1, true]    // E: eliminated (lowest Borda among tied)
          ]},
          { round: 3, results: [
            ['A', 3, false],  // A: gets E's transfer, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, true]    // D: eliminated next
          ]},
          { round: 4, results: [
            ['A', 4, false],  // A: gets D's transfer, wins majority
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false]   // C: 1 vote, survives
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Deterministic Tie-Breaking', () => {
    it('uses alphabetical sorting as secondary sort when Borda scores are identical', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],  // A=1, B gets 2 pts, C gets 1 pt  
          ['B', 'A', 'C'],  // B=1, A gets 2 pts, C gets 1 pt
          ['C', 'A', 'B']   // C=1, A gets 2 pts, B gets 1 pt
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, 4 Borda points (2+2), survives
            ['B', 1, false],  // B: 1 vote, 3 Borda points (2+1), survives  
            ['C', 1, true]    // C: 1 vote, 2 Borda points (1+1), eliminated
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: gets C's transfer, wins
            ['B', 1, false]   
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('handles perfect Borda ties with alphabetical elimination', async () => {
      await createPoll(['A', 'B'])
        .withVotes([
          ['A', 'B'],  // A=1, B gets 1 Borda point
          ['B', 'A']   // B=1, A gets 1 Borda point  
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, survives (alphabetically first)
            ['B', 1, true]    // B: eliminated alphabetically last when Borda tied
          ]},
          { round: 2, results: [
            ['A', 2, false]   // A: gets B's transfer, wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })
})