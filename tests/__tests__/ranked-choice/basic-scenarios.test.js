import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { ensureMigrationsApplied, cleanupTestPolls } from '../../helpers/database.js'

describe('Basic Ranked Choice Voting Scenarios', () => {
  beforeAll(async () => {
    await ensureMigrationsApplied()
    await cleanupTestPolls()
  })

  describe('Immediate Winners', () => {
    it('declares winner immediately when candidate has majority in first round', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],  // A=3 (majority of 5)
          ['A', 'C', 'B'],  
          ['A', 'B', 'C'],
          ['B', 'A', 'C'],  // B=1
          ['C', 'A', 'B']   // C=1
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 3, false],  // A: 3/5 = 60% majority, wins immediately
            ['B', 1, false],  
            ['C', 1, false]   
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('continues to elimination when no candidate has majority', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],  // A=2 (40%, not majority)
          ['A', 'C', 'B'],  
          ['B', 'A', 'C'],  // B=1
          ['C', 'A', 'B'],  // C=2
          ['C', 'B', 'A']   
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['C', 2, false],  // C: 2 votes, survives
            ['B', 1, true]    // B: 1 vote, eliminated
          ]},
          { round: 2, results: [
            ['A', 3, false],  // A: gets B's vote, wins with majority
            ['C', 2, false]   // C: not eliminated, A won
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Sequential Elimination', () => {
    it('eliminates candidates one by one until winner emerges', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],  // A=2
          ['A', 'C', 'B', 'D'],  
          ['B', 'A', 'C', 'D'],  // B=1
          ['C', 'B', 'A', 'D'],  // C=1
          ['D', 'A', 'B', 'C']   // D=1
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives (higher Borda score than D)
            ['C', 1, false],  // C: 1 vote, survives (higher Borda score than D)
            ['D', 1, true]    // D: 1 vote, eliminated (lowest Borda score: 7 pts)
          ]},
          { round: 2, results: [
            ['A', 3, false],  // A: gets D's transfer, wins majority
            ['B', 1, false],  
            ['C', 1, false]   
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('handles complex vote redistribution across multiple rounds', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'D', 'B', 'C'],  // A=1
          ['B', 'D', 'A', 'C'],  // B=1
          ['C', 'D', 'A', 'B'],  // C=1
          ['D', 'A', 'B', 'C'],  // D=1 - all tied, but D gets transfers
          ['D', 'B', 'A', 'C'],  // D=2
          ['D', 'C', 'B', 'A']   // D=3
        ])
        .expectRounds([
          { round: 1, results: [
            ['D', 3, false],  // D: 3 votes, survives
            ['B', 1, false],  // B: 1 vote, survives (higher Borda: 14 pts)
            ['A', 1, false],  // A: 1 vote, survives (higher Borda: 13 pts)  
            ['C', 1, true]    // C: 1 vote, eliminated (lowest Borda: 12 pts)
          ]},
          { round: 2, results: [
            ['D', 4, false],  // D: gets C's transfer, wins majority
            ['A', 1, false],  
            ['B', 1, false]   
          ]}
        ])
        .expectWinner('D')
        .run()
    })
  })

  describe('Vote Transfer Logic', () => {
    it('transfers votes correctly when preferred candidate is eliminated', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],  // A=1, but B is second choice
          ['B', 'C', 'A'],  // B=1  
          ['C', 'A', 'B']   // C=1
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, true]    // C: 1 vote, eliminated first (alphabetically last when Borda tied)
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: gets C's transfer, wins
            ['B', 1, false]   
          ]}
        ])
        .expectWinner('A')
        .run()
    })

    it('skips eliminated candidates when transferring votes', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],  // A=1, if A eliminated, goes to B
          ['C', 'A', 'B', 'D'],  // C=1, if C eliminated, goes to A  
          ['D', 'C', 'A', 'B']   // D=1, B=0 first place
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, false],  // A: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, false],  // D: 1 vote, survives
            ['B', 0, true]    // B: 0 votes, eliminated first
          ]},
          { round: 2, results: [
            ['A', 1, false],  // A: 1 vote, survives  
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 1, true]    // D: 1 vote, eliminated by Borda count
          ]},
          { round: 3, results: [
            ['C', 2, false],  // C: gets D's transfer, wins
            ['A', 1, false]   
          ]}
        ])
        .expectWinner('C')
        .run()
    })
  })
})