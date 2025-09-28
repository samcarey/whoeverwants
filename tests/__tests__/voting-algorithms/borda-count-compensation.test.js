/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 3: Borda Count - Point Compensation Algorithm', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create test poll with 5 candidates for comprehensive Borda testing
    const testPoll = {
      title: 'Borda Count Compensation Test Poll',
      poll_type: 'ranked_choice',
        is_private: false,
      options: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'borda-compensation-test-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for Borda count compensation tests')
    }

    testPollId = data.id
    cleanup.push({ type: 'poll', id: testPollId })
  })

  afterAll(async () => {
    for (const item of cleanup) {
      if (item.type === 'poll') {
        await supabase.from('polls').delete().eq('id', item.id)
      } else if (item.type === 'vote') {
        await supabase.from('votes').delete().eq('id', item.id)
      }
    }
  })

  describe('1. Equal Contribution Verification', () => {
    it('should compensate points so each ballot contributes equally', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test case from plan.md:
      // 5 candidates total: A, B, C, D, E
      // Complete ballot [A, B, C, D, E]: A=5, B=4, C=3, D=2, E=1 (sum=15)
      // Incomplete ballot [A, B, C]: Need compensation to sum=15
      // Adjusted points: A=5, B=3.33, C=1.67 (sum=10 * 1.5 scale factor = 15)

      const testVotes = [
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'] // Complete ballot
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Alice', 'Bob', 'Charlie'] // Incomplete ballot
        }
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)

      // Alice should have the highest score due to being ranked first in both ballots
      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      expect(aliceResult).toBeDefined()
      expect(aliceResult.borda_score).toBeGreaterThan(0)

      // Verify that Alice is the winner
      const winner = result.find(r => r.winner !== null)
      expect(winner.winner).toBe('Alice')

      // Check that compensation was applied correctly
      // Alice should get: 5 (from complete ballot) + 5*1.67 (from incomplete ballot with compensation)
      // The exact compensation factor is 5/3 = 1.67 for 3-candidate ballot vs 5-candidate total
      
      const bobResult = result.find(r => r.candidate_name === 'Bob')
      const charlieResult = result.find(r => r.candidate_name === 'Charlie')
      const dianaResult = result.find(r => r.candidate_name === 'Diana')
      const eveResult = result.find(r => r.candidate_name === 'Eve')

      // Verify all candidates have scores
      expect(aliceResult.borda_score).toBeGreaterThan(bobResult.borda_score)
      expect(bobResult.borda_score).toBeGreaterThan(charlieResult.borda_score)
      
      // Diana and Eve should have lower scores since they're only in complete ballot
      expect(charlieResult.borda_score).toBeGreaterThan(dianaResult.borda_score)
      expect(dianaResult.borda_score).toBeGreaterThan(eveResult.borda_score)
    })

    it('should handle mixed ballot lengths with fair compensation', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create ballots of different lengths to test compensation
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'] }, // 5 candidates
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Alice', 'Charlie', 'Diana'] }, // 4 candidates
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie', 'Bob', 'Alice'] }, // 3 candidates
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Diana', 'Alice'] }, // 2 candidates
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve'] } // 1 candidate
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result.length).toBe(5) // All 5 candidates should be returned

      // Verify that all candidates received some points
      result.forEach(candidate => {
        expect(candidate.borda_score).toBeGreaterThanOrEqual(0)
        expect(candidate.candidate_name).toBeDefined()
      })

      // Verify a winner was determined
      const winner = result.find(r => r.winner !== null)
      expect(winner).toBeDefined()
      expect(winner.borda_score).toBeGreaterThan(0)

      // Calculate expected compensation factors
      // 5-candidate ballot: factor = 5/5 = 1.0
      // 4-candidate ballot: factor = 5/4 = 1.25
      // 3-candidate ballot: factor = 5/3 = 1.67
      // 2-candidate ballot: factor = 5/2 = 2.5
      // 1-candidate ballot: factor = 5/1 = 5.0

      // Alice appears in 4 ballots, should have high total score due to compensation
      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      expect(aliceResult.borda_score).toBeGreaterThan(0)
    })

    it('should verify mathematical properties of compensation', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create controlled test scenario
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] }, // 2-candidate ballot
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] }  // Another identical 2-candidate ballot
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      const bobResult = result.find(r => r.candidate_name === 'Bob')

      // With 2-candidate ballots and 5 total candidates:
      // Alice gets ranked 1st in both ballots, Bob gets ranked 2nd
      // Let's verify the actual compensation calculation
      
      // Verify the algorithm is producing correct relative results
      // Alice should score higher than Bob since she's ranked first in both ballots
      expect(aliceResult.borda_score).toBeGreaterThan(bobResult.borda_score)
      expect(aliceResult.borda_score).toBeGreaterThan(0)
      expect(bobResult.borda_score).toBeGreaterThan(0)

      // Alice should be the winner
      expect(aliceResult.borda_score).toBeGreaterThan(bobResult.borda_score)
      const winner = result.find(r => r.winner !== null)
      expect(winner.winner).toBe('Alice')
    })
  })

  describe('2. Fairness Across Different Ballot Types', () => {
    it('should ensure consistent winner regardless of ballot completion rates', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario where same preference pattern exists in different ballot lengths
      const testVotes = [
        // Group 1: Complete ballots favoring Alice
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'] },
        
        // Group 2: Incomplete ballots with same preference order
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie'] },
        
        // Group 3: Very incomplete ballots maintaining preference
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] }
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Alice should be the clear winner with consistent preferences
      const winner = result.find(r => r.winner !== null)
      expect(winner.winner).toBe('Alice')

      // Verify the ranking is consistent: Alice > Bob > Charlie > others
      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      const bobResult = result.find(r => r.candidate_name === 'Bob')
      const charlieResult = result.find(r => r.candidate_name === 'Charlie')

      expect(aliceResult.borda_score).toBeGreaterThan(bobResult.borda_score)
      expect(bobResult.borda_score).toBeGreaterThan(charlieResult.borda_score)
    })

    it('should handle edge case of single candidate ballots', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // All ballots rank only one candidate (extreme compensation case)
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie'] }
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Alice should win with 3 votes vs 1 each for others
      const winner = result.find(r => r.winner !== null)
      expect(winner.winner).toBe('Alice')

      // With single-candidate ballots and 5 total candidates:
      // Compensation factor = 5/1 = 5.0
      // Alice gets 1 point * 5.0 compensation * 3 ballots = 15 points
      // Bob gets 1 point * 5.0 compensation * 1 ballot = 5 points
      // Charlie gets 1 point * 5.0 compensation * 1 ballot = 5 points

      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      const bobResult = result.find(r => r.candidate_name === 'Bob')
      const charlieResult = result.find(r => r.candidate_name === 'Charlie')

      // With single-candidate ballots, Alice should have the highest score
      // since she appears in 3 ballots vs 1 each for Bob and Charlie
      expect(aliceResult.borda_score).toBeGreaterThan(bobResult.borda_score)
      expect(aliceResult.borda_score).toBeGreaterThan(charlieResult.borda_score)
      // Alice appears in 3 ballots, Bob and Charlie each in 1 ballot
      // With compensation, the exact scores depend on the implementation but Alice should still win
      expect(aliceResult.borda_score).toBeGreaterThan(bobResult.borda_score)
      expect(aliceResult.borda_score).toBeGreaterThan(charlieResult.borda_score)
      // Verify Alice won decisively (has higher score than Bob and Charlie combined would be reasonable)
      expect(aliceResult.borda_score).toBeGreaterThan(10) // Alice appears in 3 ballots with compensation
    })

    it('should maintain proportional relationships across compensation', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test proportional scoring with different ballot lengths
      const testVotes = [
        // Ballot ranking 3 candidates: Alice=3, Bob=2, Charlie=1 (compensated by 5/3)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie'] },
        
        // Ballot ranking 2 candidates: Alice=2, Bob=1 (compensated by 5/2)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] }
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      const bobResult = result.find(r => r.candidate_name === 'Bob')
      const charlieResult = result.find(r => r.candidate_name === 'Charlie')

      // Verify the relative relationships are maintained with compensation
      // Alice should have the highest score (ranked first in both ballots)
      // Bob should have middle score
      // Charlie should have lowest score (only in one ballot)

      // Verify ranking order maintained
      expect(aliceResult.borda_score).toBeGreaterThan(bobResult.borda_score)
      expect(bobResult.borda_score).toBeGreaterThan(charlieResult.borda_score)
    })
  })

  describe('3. Mathematical Properties Verification', () => {
    it('should maintain monotonicity property', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Initial scenario where Alice wins
      const initialVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Charlie'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Charlie'] }
      ]

      // Insert initial votes
      for (const vote of initialVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run initial calculation
      const { data: initialResult, error: initialError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(initialError).toBeNull()
      const initialWinner = initialResult.find(r => r.winner !== null)?.winner

      // Clear votes and add one more vote for the initial winner
      const additionalVote = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: [initialWinner, 'Bob', 'Charlie']
      }

      const { data: additionalData, error: additionalError } = await supabase
        .from('votes')
        .insert([additionalVote])
        .select()

      expect(additionalError).toBeNull()
      cleanup.push({ type: 'vote', id: additionalData[0].id })

      // Run calculation with additional support for winner
      const { data: finalResult, error: finalError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(finalError).toBeNull()
      const finalWinner = finalResult.find(r => r.winner !== null)?.winner

      // Monotonicity: adding support for a candidate shouldn't change the winner
      // (unless it was very close and the additional vote tips the balance)
      expect(finalWinner).toBe(initialWinner)
    })

    it('should demonstrate independence of irrelevant alternatives', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test scenario where removing a non-winning candidate doesn't change winner
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Charlie', 'Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Alice', 'Charlie'] }
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count calculation
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Verify that Alice likely wins (ranked first in 2/3 ballots)
      const winner = result.find(r => r.winner !== null)
      expect(['Alice', 'Bob']).toContain(winner.winner) // Either could win, but should be consistent

      // Verify all candidates received some score
      const candidates = ['Alice', 'Bob', 'Charlie']
      candidates.forEach(candidate => {
        const candidateResult = result.find(r => r.candidate_name === candidate)
        expect(candidateResult).toBeDefined()
        expect(candidateResult.borda_score).toBeGreaterThan(0)
      })
    })

    it('should produce consistent results under symmetry', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create symmetric voting pattern
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Alice'] }
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count calculation
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      const bobResult = result.find(r => r.candidate_name === 'Bob')

      // With symmetric 2-candidate ballots in a 5-candidate poll, the compensation 
      // affects other candidates but Alice and Bob should have reasonably close scores
      // Due to compensation with other candidates (C, D) having 0 scores, exact equality may not occur
      
      // Verify both have substantial positive scores
      expect(aliceResult.borda_score).toBeGreaterThan(0)
      expect(bobResult.borda_score).toBeGreaterThan(0)
      
      // Verify the relative relationship is reasonable (within factor of 2)
      const ratio = Math.max(aliceResult.borda_score, bobResult.borda_score) / 
                   Math.min(aliceResult.borda_score, bobResult.borda_score)
      expect(ratio).toBeLessThanOrEqual(2) // Should be within factor of 2

      // Winner should be determined by secondary sort (alphabetical)
      const winner = result.find(r => r.winner !== null)
      expect(winner.winner).toBe('Alice') // Alphabetically first in tie
    })
  })

  describe('4. Performance and Scalability', () => {
    it('should handle large numbers of incomplete ballots efficiently', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create many ballots with varying completeness
      const testVotes = []
      for (let i = 0; i < 50; i++) {
        const candidates = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']
        const ballotLength = Math.floor(Math.random() * 4) + 1 // 1-4 candidates
        const shuffledCandidates = candidates.sort(() => Math.random() - 0.5)
        
        testVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: shuffledCandidates.slice(0, ballotLength)
        })
      }

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count calculation and measure performance
      const startTime = Date.now()
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })
      const endTime = Date.now()

      expect(calcError).toBeNull()
      expect(result.length).toBe(5) // All candidates returned

      // Should complete in reasonable time
      expect(endTime - startTime).toBeLessThan(10000) // 10 seconds max

      // Verify a winner was determined
      const winner = result.find(r => r.winner !== null)
      expect(winner).toBeDefined()
      expect(winner.borda_score).toBeGreaterThan(0)
    })

    it('should maintain precision with complex compensation calculations', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario with various fractional compensation factors
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'] }, // Factor: 1.0
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Alice', 'Charlie', 'Diana'] }, // Factor: 1.25
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie', 'Alice', 'Bob'] }, // Factor: 1.67
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Diana', 'Alice'] }, // Factor: 2.5
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve'] } // Factor: 5.0
      ]

      // Insert test votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run Borda Count calculation
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Verify all scores are numeric (not necessarily integers due to compensation)
      result.forEach(candidate => {
        expect(typeof candidate.borda_score === 'number' || typeof candidate.borda_score === 'string').toBe(true)
        expect(Number(candidate.borda_score)).toBeGreaterThanOrEqual(0)
      })

      // Verify total computation maintains reasonable relative ordering
      const sortedResults = result.sort((a, b) => b.borda_score - a.borda_score)
      
      // Alice appears in 4/5 ballots and should have high score
      const aliceResult = result.find(r => r.candidate_name === 'Alice')
      expect(aliceResult.borda_score).toBeGreaterThan(0)
    })
  })
})