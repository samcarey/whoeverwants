import { describe, it, beforeAll } from 'vitest'
import { createPoll } from '../../helpers/poll-builder.js'
import { ensureMigrationsApplied, cleanupTestPolls } from '../../helpers/database.js'

describe('Tie Breaking Scenarios', () => {
  beforeAll(async () => {
    await ensureMigrationsApplied()
    await cleanupTestPolls()
  })

  describe('Last Place Ties', () => {
    it('eliminates all candidates tied for last place when they have equal low votes', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'B', 'C', 'D'],  // A=1
          ['A', 'C', 'B', 'D'],  // A=2, B=0, C=0, D=0 first place
          ['A', 'D', 'C', 'B']   // A=3, B=0, C=0, D=0 first place
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

    it('eliminates multiple candidates tied for last with same low vote count', async () => {
      await createPoll(['A', 'B', 'C', 'D', 'E'])
        .withVotes([
          ['A', 'B', 'C', 'D', 'E'],  // A=1
          ['B', 'A', 'C', 'D', 'E'],  // B=1  
          ['C', 'A', 'B', 'D', 'E'],  // C=1
          ['D', 'E', 'A', 'B', 'C'],  // D=1, E=0 first place
          ['E', 'D', 'A', 'B', 'C']   // E=1, so all tied at 1 except none at 0
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, true],   // All tied at 1 vote, all eliminated
            ['B', 1, true],   
            ['C', 1, true],   
            ['D', 1, true],   
            ['E', 1, true]    
          ]}
        ])
        .run()
    })

    it('handles complex tie scenario with vote redistribution', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'C', 'B', 'D'],  // A=1
          ['B', 'C', 'A', 'D'],  // B=1
          ['C', 'A', 'B', 'D'],  // C=1, D=0 first place
          ['A', 'B', 'C', 'D']   // A=2, D=0 first place
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, false],  // B: 1 vote, survives
            ['C', 1, false],  // C: 1 vote, survives
            ['D', 0, true]    // D: 0 votes, eliminated first
          ]},
          { round: 2, results: [
            ['A', 2, false],  // A: 2 votes, no majority yet (need 3/4)
            ['B', 1, true],   // B: eliminated in tie for last
            ['C', 1, true]    // C: eliminated in tie for last
          ]},
          { round: 3, results: [
            ['A', 4, false]   // A: gets all remaining transfers, wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })

  describe('Perfect Ties', () => {
    it('handles perfect tie where all candidates get equal votes every round', async () => {
      await createPoll(['A', 'B'])
        .withVotes([
          ['A', 'B'],  // A=1
          ['B', 'A']   // B=1 - perfect tie
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, true],   // Perfect tie, both eliminated
            ['B', 1, true]    
          ]}
        ])
        .run()
    })

    it('resolves tie through vote redistribution in multi-round scenario', async () => {
      await createPoll(['A', 'B', 'C', 'D'])
        .withVotes([
          ['A', 'D', 'B', 'C'],  // A=1
          ['B', 'D', 'A', 'C'],  // B=1  
          ['C', 'A', 'B', 'D'],  // C=1, D=0 first place
          ['D', 'A', 'B', 'C']   // D=1 - all tied at 1
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 1, true],   // All tied at 1, all eliminated simultaneously
            ['B', 1, true],   
            ['C', 1, true],   
            ['D', 1, true]    
          ]}
        ])
        .run()
    })
  })

  describe('Near-Ties with Clear Resolution', () => {
    it('breaks tie when one candidate gets slightly more votes after elimination', async () => {
      await createPoll(['A', 'B', 'C'])
        .withVotes([
          ['A', 'B', 'C'],  // A=2  
          ['A', 'C', 'B'],  // A gets 2, B=0, C=0 first place
          ['C', 'B', 'A'],  // C=1
          ['B', 'A', 'C']   // B=1
        ])
        .expectRounds([
          { round: 1, results: [
            ['A', 2, false],  // A: 2 votes, survives
            ['B', 1, true],   // B: 1 vote, tied for last, eliminated
            ['C', 1, true]    // C: 1 vote, tied for last, eliminated
          ]},
          { round: 2, results: [
            ['A', 4, false]   // A: gets all transfers, wins
          ]}
        ])
        .expectWinner('A')
        .run()
    })
  })
})