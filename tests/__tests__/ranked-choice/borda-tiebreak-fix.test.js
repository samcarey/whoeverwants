import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { ensureMigrationsApplied, cleanupTestPolls } from '../../helpers/database.js'

describe('Borda Count Tie-Breaking Fix', () => {
  beforeAll(async () => {
    await ensureMigrationsApplied()
    await cleanupTestPolls()
  })

  it('should eliminate C before A when A and C have same Borda score but B has higher score', async () => {
    // This reproduces the user's exact bug report:
    // A and C have same first-choice votes and same Borda score
    // B has higher Borda score (should be safe from elimination)
    // Between A and C (who are tied for lowest Borda), C should be eliminated alphabetically
    
    await createPoll(['A', 'B', 'C'])
      .withVotes([
        ['A', 'B', 'C'],  // A=3pts, B=2pts, C=1pt
        ['C', 'B', 'A'],  // C=3pts, B=2pts, A=1pt  
        ['B', 'C', 'A']   // B=3pts, C=2pts, A=1pt
      ])
      // Vote counts: A=1, B=1, C=1 (all tied for first place)
      // Borda scores: A=3+1+1=5, B=2+2+3=7, C=1+2+2=5
      // B has highest Borda score (7), should be safe
      // A and C are tied for lowest Borda score (5 each)
      // Between A and C, C should be eliminated alphabetically (C comes after A)
      .expectRounds([
        { round: 1, results: [
          ['A', 1, false],  // A: 1 vote, 5 Borda points, survives (alphabetically first among tied)
          ['B', 1, false],  // B: 1 vote, 7 Borda points, survives (highest Borda)
          ['C', 1, true]    // C: 1 vote, 5 Borda points, eliminated (alphabetically last among lowest Borda)
        ]},
        { round: 2, results: [
          ['B', 2, false],  // B: gets C's transfer vote, wins
          ['A', 1, false]   // A: 1 vote, survives
        ]}
      ])
      .expectWinner('B')
      .run()
  })

  it('should handle multiple candidates tied for lowest Borda score', async () => {
    // Test with 4 candidates where 2 have higher Borda, 2 have same lowest Borda
    await createPoll(['A', 'B', 'C', 'D'])
      .withVotes([
        ['A', 'B', 'C', 'D'],  // A=4, B=3, C=2, D=1
        ['D', 'C', 'B', 'A'],  // D=4, C=3, B=2, A=1
        ['B', 'A', 'D', 'C'],  // B=4, A=3, D=2, C=1  
        ['C', 'D', 'A', 'B']   // C=4, D=3, A=2, B=1
      ])
      // Vote counts: A=1, B=1, C=1, D=1 (all tied)
      // Borda scores: A=4+1+3+2=10, B=3+2+4+1=10, C=2+3+1+4=10, D=1+4+2+3=10
      // All have same Borda score (10), so should eliminate alphabetically: A first
      .expectRounds([
        { round: 1, results: [
          ['B', 1, false],  // B: 1 vote, 10 Borda points, survives
          ['C', 1, false],  // C: 1 vote, 10 Borda points, survives  
          ['D', 1, false],  // D: 1 vote, 10 Borda points, survives
          ['A', 1, true]    // A: 1 vote, 10 Borda points, eliminated (alphabetically first)
        ]}
      ])
      .run()
  })

  it('should only consider lowest Borda score candidates for alphabetical elimination', async () => {
    // Complex scenario: some candidates clearly have higher Borda, others tied for lowest
    await createPoll(['A', 'B', 'C', 'D'])
      .withVotes([
        ['A', 'B', 'D', 'C'],  // A=4, B=3, D=2, C=1
        ['B', 'A', 'D', 'C'],  // B=4, A=3, D=2, C=1
        ['C', 'D', 'A', 'B'],  // C=4, D=3, A=2, B=1
        ['D', 'C', 'A', 'B']   // D=4, C=3, A=2, B=1
      ])
      // Vote counts: A=1, B=1, C=1, D=1 (all tied)
      // Borda scores: A=4+3+2+2=11, B=3+4+1+1=9, C=1+1+4+3=9, D=2+2+3+4=11
      // A and D tied for highest Borda (11), should be safe
      // B and C tied for lowest Borda (9), should eliminate B alphabetically
      .expectRounds([
        { round: 1, results: [
          ['A', 1, false],  // A: 1 vote, 11 Borda points, survives (highest Borda)
          ['C', 1, false],  // C: 1 vote, 9 Borda points, survives (lowest Borda, but C > B alphabetically)
          ['D', 1, false],  // D: 1 vote, 11 Borda points, survives (highest Borda)  
          ['B', 1, true]    // B: 1 vote, 9 Borda points, eliminated (lowest Borda, alphabetically first)
        ]}
      ])
      .run()
  })
})