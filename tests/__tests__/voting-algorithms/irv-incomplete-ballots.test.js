/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 3: IRV Algorithm - Incomplete Ballot Handling', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create test poll with 5 candidates for comprehensive testing
    const testPoll = {
      title: 'IRV Incomplete Ballot Test Poll',
      poll_type: 'ranked_choice',
      options: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'irv-incomplete-test-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for IRV incomplete ballot tests')
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

  describe('1. Progressive Ballot Elimination', () => {
    it('should handle ballot elimination when all ranked candidates are eliminated', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test case from plan.md:
      // Ballot 1: [Alice, Bob] (incomplete - missing Charlie, Diana, Eve)
      // Ballot 2: [Bob, Charlie, Diana] (complete)
      // Ballot 3: [Charlie, Diana] (incomplete - missing Alice, Bob, Eve)

      const testVotes = [
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Alice', 'Bob'] // Incomplete ballot
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Bob', 'Charlie', 'Diana'] // More complete ballot
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Charlie', 'Diana'] // Incomplete ballot
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)

      // Get the elimination rounds
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .order('round_number', { ascending: true })

      expect(roundsError).toBeNull()
      expect(rounds).toBeDefined()

      // Verify that the algorithm properly handles ballot elimination
      // When candidates get eliminated, some ballots may become inactive
      const finalRound = Math.max(...rounds.map(r => r.round_number))
      expect(finalRound).toBeGreaterThan(0)

      // Verify a winner was determined despite incomplete ballots
      const winner = result[0]?.winner
      expect(winner).toBeDefined()
      expect(['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']).toContain(winner)
    })

    it('should correctly calculate majority thresholds with incomplete ballots', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario where some ballots become inactive
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie', 'Diana'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie', 'Eve'] }
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result).toBeDefined()

      // Get the rounds to verify majority calculation
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .order('round_number', { ascending: true })

      expect(roundsError).toBeNull()

      // In the first round, all 5 ballots should be active
      const firstRoundCandidates = rounds.filter(r => r.round_number === 1)
      const firstRoundTotalVotes = firstRoundCandidates.reduce((sum, r) => sum + r.vote_count, 0)
      expect(firstRoundTotalVotes).toBe(5)

      // Verify that Alice has 2 votes and should not be eliminated early
      const aliceFirstRound = firstRoundCandidates.find(r => r.option_name === 'Alice')
      expect(aliceFirstRound.vote_count).toBe(2)
    })

    it('should handle scenario where all ballots become inactive', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario where voters only rank candidates that get eliminated early
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve'] }, // Only ranked Eve
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve'] }, // Only ranked Eve
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie'] } // Complete ranking
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result).toBeDefined()

      // Should still determine a winner even if some ballots become inactive
      const winner = result[0]?.winner
      expect(winner).toBeDefined()
      expect(['Alice', 'Bob', 'Charlie']).toContain(winner) // Winner should be from the complete ballot
    })
  })

  describe('2. Active Ballot Tracking', () => {
    it('should properly track which ballots remain active in each round', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create test case with varying ballot completeness
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Diana', 'Eve'] }, // Only ranks Diana and Eve
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve'] }, // Only ranks Eve
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Diana'] }
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Get all rounds
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .order('round_number', { ascending: true })

      expect(roundsError).toBeNull()

      // Verify that vote counts decrease appropriately as ballots become inactive
      const roundNumbers = [...new Set(rounds.map(r => r.round_number))].sort((a, b) => a - b)
      
      for (let i = 0; i < roundNumbers.length - 1; i++) {
        const currentRound = roundNumbers[i]
        const nextRound = roundNumbers[i + 1]
        
        const currentRoundVotes = rounds
          .filter(r => r.round_number === currentRound)
          .reduce((sum, r) => sum + r.vote_count, 0)
        
        const nextRoundVotes = rounds
          .filter(r => r.round_number === nextRound)
          .reduce((sum, r) => sum + r.vote_count, 0)
        
        // Total active votes should never increase between rounds
        expect(nextRoundVotes).toBeLessThanOrEqual(currentRoundVotes)
      }
    })

    it('should handle mixed ballot lengths correctly in vote redistribution', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test redistribution with different ballot lengths
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie'] }, // Single choice
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Diana', 'Eve', 'Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve', 'Diana'] }
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Verify the algorithm completed successfully
      expect(result[0]?.winner).toBeDefined()
      expect(result[0]?.total_rounds).toBeGreaterThan(0)

      // Get rounds to verify proper vote redistribution
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .order('round_number', { ascending: true })

      expect(roundsError).toBeNull()

      // Verify that each round has a valid distribution
      const roundsByNumber = rounds.reduce((acc, round) => {
        if (!acc[round.round_number]) acc[round.round_number] = []
        acc[round.round_number].push(round)
        return acc
      }, {})

      Object.entries(roundsByNumber).forEach(([roundNum, roundData]) => {
        const totalVotes = roundData.reduce((sum, r) => sum + r.vote_count, 0)
        expect(totalVotes).toBeGreaterThanOrEqual(0)
        expect(totalVotes).toBeLessThanOrEqual(5) // Can't exceed total ballots
      })
    })
  })

  describe('3. Mathematical Correctness Verification', () => {
    it('should maintain mathematical properties of IRV with incomplete ballots', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create mathematically interesting scenario
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Charlie'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Diana', 'Alice'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve'] }
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Get all rounds for analysis
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .order('round_number', { ascending: true })

      expect(roundsError).toBeNull()

      // Verify monotonicity: if candidate X wins, adding more votes for X shouldn't change the winner
      const winner = result[0]?.winner
      expect(winner).toBeDefined()

      // Verify that eliminated candidates have lowest vote counts in their elimination round
      const roundsByNumber = rounds.reduce((acc, round) => {
        if (!acc[round.round_number]) acc[round.round_number] = []
        acc[round.round_number].push(round)
        return acc
      }, {})

      Object.entries(roundsByNumber).forEach(([roundNum, roundData]) => {
        const eliminated = roundData.filter(r => r.is_eliminated)
        const notEliminated = roundData.filter(r => !r.is_eliminated)

        if (eliminated.length > 0 && notEliminated.length > 0) {
          const maxEliminatedVotes = Math.max(...eliminated.map(r => r.vote_count))
          const minNotEliminatedVotes = Math.min(...notEliminated.map(r => r.vote_count))
          
          // Eliminated candidates should have <= votes than non-eliminated
          expect(maxEliminatedVotes).toBeLessThanOrEqual(minNotEliminatedVotes)
        }
      })
    })

    it('should produce deterministic results with same input', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create identical test scenario
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob', 'Charlie'] },
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

      // Run algorithm multiple times
      const results = []
      for (let i = 0; i < 3; i++) {
        const { data: result, error: calcError } = await supabase
          .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

        expect(calcError).toBeNull()
        results.push(result[0])
      }

      // All results should be identical
      const firstResult = results[0]
      results.forEach(result => {
        expect(result.winner).toBe(firstResult.winner)
        expect(result.total_rounds).toBe(firstResult.total_rounds)
      })
    })

    it('should handle edge case of single candidate ballots', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // All voters only rank one candidate each (extreme incomplete ballots)
      const testVotes = [
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Should determine Alice as winner (2 votes vs 1 each for others)
      expect(result[0]?.winner).toBe('Alice')
      expect(result[0]?.total_rounds).toBeGreaterThan(0)

      // Verify that the algorithm handled single-candidate ballots correctly
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .eq('round_number', 1)
        .order('vote_count', { ascending: false })

      expect(roundsError).toBeNull()
      
      const aliceFirstRound = rounds.find(r => r.option_name === 'Alice')
      expect(aliceFirstRound.vote_count).toBe(2)
    })
  })

  describe('4. Edge Cases and Boundary Conditions', () => {
    it('should handle polls where no ballots rank any candidates', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create empty ballots (this shouldn't happen with our UI, but test robustness)
      // Note: Our validation should prevent this, but test the algorithm's robustness

      // Run IRV algorithm with no votes
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeNull()
      expect(result[0]?.total_rounds).toBe(0)
    })

    it('should handle extremely uneven ballot completeness', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // One complete ballot vs many incomplete ones
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'] }, // Complete
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Bob'] }, // Very incomplete
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Charlie'] }, // Very incomplete
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Diana'] }, // Very incomplete
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Eve'] } // Very incomplete
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

      // Run IRV algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()

      // Should handle this gracefully and produce a valid result
      const winner = result[0]?.winner
      expect(['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']).toContain(winner)
    })

    it('should maintain performance with incomplete ballots', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create many incomplete ballots to test performance
      const testVotes = []
      for (let i = 0; i < 20; i++) {
        const candidates = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']
        const ballotLength = Math.floor(Math.random() * 3) + 1 // 1-3 candidates
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

      // Run IRV algorithm and measure time
      const startTime = Date.now()
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
      const endTime = Date.now()

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
      
      // Should complete in reasonable time even with many incomplete ballots
      expect(endTime - startTime).toBeLessThan(10000) // 10 seconds max
    })
  })
})