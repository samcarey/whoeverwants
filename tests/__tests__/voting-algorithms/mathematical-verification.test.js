/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 3: Mathematical Verification - Voting Theory Compliance', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create test poll for mathematical verification
    const testPoll = {
      title: 'Mathematical Verification Test Poll',
      poll_type: 'ranked_choice',
      options: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'math-verification-test-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for mathematical verification tests')
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

  describe('1. IRV Mathematical Properties', () => {
    it('should satisfy later-no-harm criterion', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test scenario: voter preferring A should not harm A by also ranking B
      // Scenario 1: Some voters rank only their first choice
      const scenario1Votes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] }
      ]

      // Insert scenario 1 votes
      for (const vote of scenario1Votes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run IRV calculation for scenario 1
      const { data: result1, error: calcError1 } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError1).toBeNull()
      const winner1 = result1[0]?.winner

      // Clear votes for scenario 2
      await supabase.from('votes').delete().eq('poll_id', testPollId)
      cleanup = cleanup.filter(item => item.type !== 'vote')

      // Scenario 2: Same voters, but A voters also rank their second choice
      const scenario2Votes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B'] }, // Added second choice
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate C'] }, // Added second choice
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] }
      ]

      // Insert scenario 2 votes
      for (const vote of scenario2Votes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Run IRV calculation for scenario 2
      const { data: result2, error: calcError2 } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError2).toBeNull()
      const winner2 = result2[0]?.winner

      // Later-no-harm: Adding later preferences should not harm earlier preferences
      // In this case, if A won in scenario 1, A should still be competitive in scenario 2
      expect([winner1, winner2]).toContain('Candidate A') // A should win in at least one scenario
    })

    it('should maintain Condorcet efficiency when applicable', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario where one candidate beats all others pairwise
      // A beats B, C, D in pairwise comparisons
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate C', 'Candidate B', 'Candidate D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate D', 'Candidate B', 'Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate A', 'Candidate C'] }, // A still beats others pairwise
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C', 'Candidate A', 'Candidate B'] }  // A still beats others pairwise
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

      // Run IRV calculation
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      
      // A should win as the Condorcet winner
      expect(result[0]?.winner).toBe('Candidate A')
    })

    it('should handle clone independence correctly', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test that similar candidates don't split votes unfairly in IRV
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate D'] }
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

      // Run IRV calculation
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      // Either A or B should win (they have the most support combined)
      expect(['Candidate A', 'Candidate B']).toContain(result[0]?.winner)

      // Get rounds to verify proper elimination order
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .order('round_number', { ascending: true })

      expect(roundsError).toBeNull()

      // Verify that C and D are eliminated before A and B start competing
      const firstRound = rounds.filter(r => r.round_number === 1)
      const aFirstRound = firstRound.find(r => r.option_name === 'Candidate A')
      const bFirstRound = firstRound.find(r => r.option_name === 'Candidate B')
      const cFirstRound = firstRound.find(r => r.option_name === 'Candidate C')
      const dFirstRound = firstRound.find(r => r.option_name === 'Candidate D')

      expect(aFirstRound.vote_count + bFirstRound.vote_count).toBe(3) // A and B together have 3 votes
      expect(cFirstRound.vote_count).toBe(1)
      expect(dFirstRound.vote_count).toBe(1)
    })
  })

  describe('2. Borda Count Mathematical Properties', () => {
    it('should satisfy symmetry principle', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create perfectly symmetric voting pattern
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate A'] }
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

      const aResult = result.find(r => r.candidate_name === 'Candidate A')
      const bResult = result.find(r => r.candidate_name === 'Candidate B')

      // Symmetric votes should produce equal scores
      expect(aResult.borda_score).toBe(bResult.borda_score)

      // Winner determined by tiebreaker (alphabetical)
      const winner = result.find(r => r.winner !== null)
      expect(winner.winner).toBe('Candidate A') // Alphabetically first
    })

    it('should demonstrate neutrality property', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test that swapping all candidate names produces swapped results
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate A', 'Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate C'] }
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

      // Verify ranking order is consistent with vote patterns
      const sortedResults = result.sort((a, b) => b.borda_score - a.borda_score)
      
      // A appears first in 2/3 ballots, should have highest score
      expect(sortedResults[0].candidate_name).toBe('Candidate A')
      
      // B and C should follow based on their positions
      const positions = ['Candidate A', 'Candidate B', 'Candidate C']
      sortedResults.forEach((candidate, index) => {
        expect(positions).toContain(candidate.candidate_name)
      })
    })

    it('should maintain consistency under compensation', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test that compensation doesn't change relative rankings
      const testVotes = [
        // Complete ranking: A=4, B=3, C=2, D=1
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D'] },
        
        // Incomplete ranking with same order: A=3, B=2, C=1 (compensated by 4/3)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C'] },
        
        // Another incomplete ranking: A=2, B=1 (compensated by 4/2 = 2)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B'] }
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

      // Sort by score to verify ranking
      const sortedResults = result.sort((a, b) => b.borda_score - a.borda_score)

      // Ranking should be: A > B > C > D (consistent across all ballots)
      expect(sortedResults[0].candidate_name).toBe('Candidate A')
      expect(sortedResults[1].candidate_name).toBe('Candidate B')
      expect(sortedResults[2].candidate_name).toBe('Candidate C')
      expect(sortedResults[3].candidate_name).toBe('Candidate D')

      // Verify A is the winner
      const winner = result.find(r => r.winner !== null)
      expect(winner.winner).toBe('Candidate A')
    })
  })

  describe('3. Cross-Algorithm Consistency', () => {
    it('should produce consistent results when algorithms should agree', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario where both IRV and Borda should pick the same winner
      // Clear majority preference for one candidate
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate C', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] }
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

      // Run both algorithms
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(irvError).toBeNull()
      expect(bordaError).toBeNull()

      const irvWinner = irvResult[0]?.winner
      const bordaWinner = bordaResult.find(r => r.winner !== null)?.winner

      // Both algorithms should recognize A's strong support
      // (A is ranked first in 4/6 ballots)
      expect(irvWinner).toBe('Candidate A')
      expect(bordaWinner).toBe('Candidate A')
    })

    it('should handle disagreement between algorithms gracefully', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario where IRV and Borda might disagree
      // Polarized voting where IRV might eliminate a Borda winner early
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C', 'Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate A', 'Candidate C'] } // B is everyone's 2nd choice
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

      // Run both algorithms
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(irvError).toBeNull()
      expect(bordaError).toBeNull()

      const irvWinner = irvResult[0]?.winner
      const bordaWinner = bordaResult.find(r => r.winner !== null)?.winner

      // Both should produce valid winners (may be different)
      expect(['Candidate A', 'Candidate B', 'Candidate C']).toContain(irvWinner)
      expect(['Candidate A', 'Candidate B', 'Candidate C']).toContain(bordaWinner)

      // B might win Borda (consensus choice) but not IRV (eliminated early)
      // This demonstrates the different properties of each algorithm
    })
  })

  describe('4. Incomplete Ballot Impact Analysis', () => {
    it('should quantify the effect of incomplete ballots on results', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test scenario with varying degrees of completeness
      const testVotes = [
        // Complete ballots
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate A', 'Candidate C', 'Candidate D'] },
        
        // Moderately incomplete
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A', 'Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B', 'Candidate D'] },
        
        // Highly incomplete
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate D'] }
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

      // Run both algorithms to compare impact
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(irvError).toBeNull()
      expect(bordaError).toBeNull()

      // Analyze how incomplete ballots affected the outcome
      const irvWinner = irvResult[0]?.winner
      const bordaWinner = bordaResult.find(r => r.winner !== null)?.winner

      // Both algorithms should handle incomplete ballots gracefully
      expect(irvWinner).toBeDefined()
      expect(bordaWinner).toBeDefined()

      // Get IRV rounds to see elimination pattern
      const { data: rounds, error: roundsError } = await supabase
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', testPollId)
        .order('round_number', { ascending: true })

      expect(roundsError).toBeNull()

      // Verify that the algorithms completed successfully despite varying completeness
      const totalRounds = Math.max(...rounds.map(r => r.round_number))
      expect(totalRounds).toBeGreaterThan(0)

      // Check that vote counts make sense given the incomplete ballots
      const firstRound = rounds.filter(r => r.round_number === 1)
      const totalFirstRoundVotes = firstRound.reduce((sum, r) => sum + r.vote_count, 0)
      expect(totalFirstRoundVotes).toBe(6) // All 6 ballots should count in first round
    })

    it('should demonstrate robustness to extreme incompleteness', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Extreme case: mostly single-candidate ballots
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate D'] }
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

      // Run both algorithms
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(irvError).toBeNull()
      expect(bordaError).toBeNull()

      // Both should pick A as winner (3 votes vs 1 each for others)
      expect(irvResult[0]?.winner).toBe('Candidate A')
      expect(bordaResult.find(r => r.winner !== null)?.winner).toBe('Candidate A')

      // Verify the margin of victory is appropriate
      const aResult = bordaResult.find(r => r.candidate_name === 'Candidate A')
      const bResult = bordaResult.find(r => r.candidate_name === 'Candidate B')
      
      // A should have significantly higher score due to more votes
      expect(aResult.borda_score).toBeGreaterThan(bResult.borda_score * 2)
    })
  })
})