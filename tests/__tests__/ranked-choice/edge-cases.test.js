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
          ['A', 'B'],  // A=1
          ['B', 'A']   // B=1, perfect tie
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, true],   // Tie, both eliminated
            ['B', 1, true]    
          ]}
        ])
        .run()
    })
  })

  describe('Incomplete and Invalid Ballots', () => {
    it('handles ballots with only one candidate ranked', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A'],           // Only A ranked
          ['B', 'A'],      // B first, A second, C unranked
          ['C', 'B', 'A']  // All ranked
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote
            ['B', 1, false],  // B: 1 vote  
            ['C', 1, false]   // C: 1 vote
          ]},
          { round: 2, results: [
            ['A', 1, true],   // All eliminated in tie
            ['B', 1, true],   
            ['C', 1, true]    
          ]}
        ])
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
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, true]    // D: 0 votes, eliminated
          ]},
          { round: 2, results: [
            ['A', 3, false],  // A: gets D's transfer, wins
            ['B', 1, true],   // B and C tied for elimination
            ['C', 1, true]    
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
            ['D', 0, true],   // D, E, F, G: 0 votes, eliminated
            ['E', 0, true],   
            ['F', 0, true],   
            ['G', 0, true]    
          ]},
          { round: 2, results: [
            ['A', 4, false],  // A: gets all transfers, wins
            ['B', 1, true],   
            ['C', 1, true]    
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
          ['A', 'B', 'C'],  // Normal order
          ['C', 'B', 'A'],  // Reverse order
          ['B', 'A', 'C']   // Mixed order
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // All tied at 1 vote
            ['B', 1, false],  
            ['C', 1, false]   
          ]},
          { round: 2, results: [
            ['A', 1, true],   // All eliminated in tie
            ['B', 1, true],   
            ['C', 1, true]    
          ]}
        ])
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
            ['D', 0, true]    // D: 0 votes, eliminated despite being ranked high
          ]},
          { round: 2, results: [
            ['A', 4, false],  // A: gets D's transfers, wins
            ['B', 1, true],   
            ['C', 1, true]    
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
            ['A', 2, true],   // Still tied after C elimination
            ['B', 2, true]    
          ]}
        ])
        .run()
    })
  })
})