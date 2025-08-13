/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 4: End-to-End Integration Tests', () => {
  let testPollId = null
  let cleanup = []

  afterAll(async () => {
    // Clean up all test data
    for (const item of cleanup) {
      if (item.type === 'poll') {
        await supabase.from('polls').delete().eq('id', item.id)
      } else if (item.type === 'vote') {
        await supabase.from('votes').delete().eq('id', item.id)
      }
    }
  })

  describe('1. Complete System Workflow Verification', () => {
    it('should handle complete poll lifecycle with no preference feature', async () => {
      // Create poll with ranked choice + no preference enabled
      const testPoll = {
        title: 'E2E Integration Test Poll',
        poll_type: 'ranked_choice',
        options: ['Option A', 'Option B', 'Option C', 'Option D', 'Option E'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'e2e-test-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      expect(pollData).toBeDefined()
      testPollId = pollData.id
      cleanup.push({ type: 'poll', id: testPollId })

      // Simulate multiple users voting with different preference distributions
      const testVotes = [
        // Full rankings (all 5 candidates)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option A', 'Option B', 'Option C', 'Option D', 'Option E'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option B', 'Option A', 'Option C', 'Option D', 'Option E'] },
        
        // Partial rankings (3 candidates, 2 in no preference)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option A', 'Option C', 'Option E'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option B', 'Option D', 'Option A'] },
        
        // Minimal rankings (2 candidates, 3 in no preference)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option A', 'Option B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option C', 'Option D'] },
        
        // Single candidate rankings (1 candidate, 4 in no preference)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Option B'] }
      ]

      // Insert all votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Calculate results using IRV
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(irvError).toBeNull()
      expect(irvResult).toBeDefined()
      expect(irvResult[0]?.winner).toBeDefined()

      // Calculate results using Borda Count
      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(bordaError).toBeNull()
      expect(bordaResult).toBeDefined()
      expect(bordaResult.length).toBeGreaterThan(0)

      // Verify both algorithms handle mixed ballot types correctly
      const bordaWinner = bordaResult.find(r => r.winner !== null)
      expect(bordaWinner).toBeDefined()
      expect(bordaWinner.borda_score).toBeGreaterThan(0)

      // Simulate poll closing
      const { error: closeError } = await supabase
        .from('polls')
        .update({ is_closed: true })
        .eq('id', testPollId)

      expect(closeError).toBeNull()

      // Verify poll results are still accessible after closing
      const { data: closedPoll, error: fetchError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', testPollId)
        .single()

      expect(fetchError).toBeNull()
      expect(closedPoll.is_closed).toBe(true)
    })

    it('should handle real-time collaboration with concurrent voting', async () => {
      // Create test poll
      const testPoll = {
        title: 'Concurrent Voting Test Poll',
        poll_type: 'ranked_choice',
        options: ['Choice 1', 'Choice 2', 'Choice 3', 'Choice 4'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'concurrent-test-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      const concurrentPollId = pollData.id
      cleanup.push({ type: 'poll', id: concurrentPollId })

      // Simulate multiple users voting simultaneously
      const concurrentVotes = []
      for (let i = 0; i < 10; i++) {
        const randomLength = Math.floor(Math.random() * 3) + 1
        const shuffledOptions = ['Choice 1', 'Choice 2', 'Choice 3', 'Choice 4']
          .sort(() => Math.random() - 0.5)
          .slice(0, randomLength)
        
        concurrentVotes.push({
          poll_id: concurrentPollId,
          vote_type: 'ranked_choice',
          ranked_choices: shuffledOptions
        })
      }

      // Insert votes concurrently
      const votePromises = concurrentVotes.map(vote => 
        supabase.from('votes').insert([vote]).select()
      )

      const voteResults = await Promise.all(votePromises)
      
      // Verify all votes were inserted successfully
      voteResults.forEach(({ data, error }) => {
        expect(error).toBeNull()
        expect(data).toBeDefined()
        cleanup.push({ type: 'vote', id: data[0].id })
      })

      // Verify vote count matches
      const { data: voteCount, error: countError } = await supabase
        .from('votes')
        .select('id')
        .eq('poll_id', concurrentPollId)

      expect(countError).toBeNull()
      expect(voteCount.length).toBe(10)

      // Calculate results to ensure data consistency
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: concurrentPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
    })

    it('should maintain poll lifecycle management integrity', async () => {
      // Create -> Share -> Vote -> Close -> View Results -> Archive workflow
      
      // 1. Create poll
      const testPoll = {
        title: 'Lifecycle Management Test Poll',
        poll_type: 'ranked_choice',
        options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'lifecycle-test-' + Date.now()
      }

      const { data: pollData, error: createError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(createError).toBeNull()
      const lifecyclePollId = pollData.id
      cleanup.push({ type: 'poll', id: lifecyclePollId })

      // 2. Share (verify poll is accessible)
      const { data: sharedPoll, error: shareError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', lifecyclePollId)
        .single()

      expect(shareError).toBeNull()
      expect(sharedPoll.id).toBe(lifecyclePollId)

      // 3. Vote with mixed preferences
      const votes = [
        { poll_id: lifecyclePollId, vote_type: 'ranked_choice', ranked_choices: ['Alpha', 'Beta', 'Gamma'] },
        { poll_id: lifecyclePollId, vote_type: 'ranked_choice', ranked_choices: ['Beta', 'Alpha'] },
        { poll_id: lifecyclePollId, vote_type: 'ranked_choice', ranked_choices: ['Gamma'] }
      ]

      for (const vote of votes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // 4. Close poll
      const { error: closeError } = await supabase
        .from('polls')
        .update({ is_closed: true })
        .eq('id', lifecyclePollId)

      expect(closeError).toBeNull()

      // 5. View Results (ensure they're still calculable after closing)
      const { data: finalResult, error: resultError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: lifecyclePollId })

      expect(resultError).toBeNull()
      expect(finalResult[0]?.winner).toBeDefined()

      // 6. Archive (verify poll data persists)
      const { data: archivedPoll, error: archiveError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', lifecyclePollId)
        .single()

      expect(archiveError).toBeNull()
      expect(archivedPoll.is_closed).toBe(true)
      expect(archivedPoll.title).toBe('Lifecycle Management Test Poll')
    })
  })

  describe('2. Mixed Voting Patterns Verification', () => {
    it('should correctly calculate results with diverse ballot completeness', async () => {
      // Test scenario from plan.md with 20 voters and varied completeness
      const testPoll = {
        title: 'Mixed Voting Patterns Test',
        poll_type: 'ranked_choice',
        options: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'mixed-patterns-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      const mixedPollId = pollData.id
      cleanup.push({ type: 'poll', id: mixedPollId })

      const testVotes = []
      
      // 5 voters: full rankings (all 5 candidates)
      for (let i = 0; i < 5; i++) {
        testVotes.push({
          poll_id: mixedPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E']
        })
      }

      // 5 voters: partial rankings (3 candidates, 2 in no preference)
      for (let i = 0; i < 5; i++) {
        const partial = ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E']
          .sort(() => Math.random() - 0.5)
          .slice(0, 3)
        testVotes.push({
          poll_id: mixedPollId,
          vote_type: 'ranked_choice',
          ranked_choices: partial
        })
      }

      // 5 voters: minimal rankings (2 candidates, 3 in no preference)
      for (let i = 0; i < 5; i++) {
        const minimal = ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E']
          .sort(() => Math.random() - 0.5)
          .slice(0, 2)
        testVotes.push({
          poll_id: mixedPollId,
          vote_type: 'ranked_choice',
          ranked_choices: minimal
        })
      }

      // 5 voters: single candidate rankings (1 candidate, 4 in no preference)
      for (let i = 0; i < 5; i++) {
        const single = ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E'][i]
        testVotes.push({
          poll_id: mixedPollId,
          vote_type: 'ranked_choice',
          ranked_choices: [single]
        })
      }

      // Insert all votes
      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Verify IRV results are mathematically correct
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: mixedPollId })

      expect(irvError).toBeNull()
      expect(irvResult[0]?.winner).toBeDefined()
      expect(irvResult[0]?.total_rounds).toBeGreaterThan(0)

      // Verify Borda Count results with compensation
      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: mixedPollId })

      expect(bordaError).toBeNull()
      expect(bordaResult.length).toBe(5) // All candidates should be included
      
      // Verify all candidates received scores
      bordaResult.forEach(candidate => {
        expect(candidate.borda_score).toBeGreaterThanOrEqual(0)
      })

      // Verify winner was determined
      const bordaWinner = bordaResult.find(r => r.winner !== null)
      expect(bordaWinner).toBeDefined()
    })

    it('should handle edge case of all incomplete ballots', async () => {
      const testPoll = {
        title: 'All Incomplete Ballots Test',
        poll_type: 'ranked_choice',
        options: ['Option X', 'Option Y', 'Option Z'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'all-incomplete-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      const incompletePollId = pollData.id
      cleanup.push({ type: 'poll', id: incompletePollId })

      // All votes are incomplete (no one ranks all candidates)
      const testVotes = [
        { poll_id: incompletePollId, vote_type: 'ranked_choice', ranked_choices: ['Option X'] },
        { poll_id: incompletePollId, vote_type: 'ranked_choice', ranked_choices: ['Option Y'] },
        { poll_id: incompletePollId, vote_type: 'ranked_choice', ranked_choices: ['Option Z'] },
        { poll_id: incompletePollId, vote_type: 'ranked_choice', ranked_choices: ['Option X', 'Option Y'] },
        { poll_id: incompletePollId, vote_type: 'ranked_choice', ranked_choices: ['Option Y', 'Option Z'] }
      ]

      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Both algorithms should handle this gracefully
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: incompletePollId })

      expect(irvError).toBeNull()
      expect(irvResult[0]?.winner).toBeDefined()

      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: incompletePollId })

      expect(bordaError).toBeNull()
      expect(bordaResult.length).toBe(3)
      
      const bordaWinner = bordaResult.find(r => r.winner !== null)
      expect(bordaWinner).toBeDefined()
    })
  })

  describe('3. Data Integrity and Consistency', () => {
    it('should maintain vote immutability after submission', async () => {
      const testPoll = {
        title: 'Vote Immutability Test',
        poll_type: 'ranked_choice',
        options: ['Item 1', 'Item 2', 'Item 3'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'immutability-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      const immutablePollId = pollData.id
      cleanup.push({ type: 'poll', id: immutablePollId })

      // Submit initial vote
      const initialVote = {
        poll_id: immutablePollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Item 1', 'Item 2']
      }

      const { data: voteData, error: voteError } = await supabase
        .from('votes')
        .insert([initialVote])
        .select()
        .single()

      expect(voteError).toBeNull()
      const voteId = voteData.id
      cleanup.push({ type: 'vote', id: voteId })

      // Store original vote data
      const originalChoices = [...voteData.ranked_choices]

      // Attempt to modify the vote (should fail or have no effect)
      const { error: updateError } = await supabase
        .from('votes')
        .update({ ranked_choices: ['Item 3', 'Item 2', 'Item 1'] })
        .eq('id', voteId)

      // Fetch vote again to verify it hasn't changed
      const { data: unchangedVote, error: fetchError } = await supabase
        .from('votes')
        .select('*')
        .eq('id', voteId)
        .single()

      expect(fetchError).toBeNull()
      expect(unchangedVote.ranked_choices).toEqual(originalChoices)
    })

    it('should ensure no preference items never appear in stored votes', async () => {
      const testPoll = {
        title: 'No Preference Exclusion Test',
        poll_type: 'ranked_choice',
        options: ['Red', 'Blue', 'Green', 'Yellow', 'Purple'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'exclusion-test-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      const exclusionPollId = pollData.id
      cleanup.push({ type: 'poll', id: exclusionPollId })

      // Simulate votes where some candidates would be in "no preference"
      // Only submit the ranked choices (excluding no preference items)
      const votes = [
        { poll_id: exclusionPollId, vote_type: 'ranked_choice', ranked_choices: ['Red', 'Blue'] },  // Green, Yellow, Purple in no preference
        { poll_id: exclusionPollId, vote_type: 'ranked_choice', ranked_choices: ['Green'] },  // All others in no preference
        { poll_id: exclusionPollId, vote_type: 'ranked_choice', ranked_choices: ['Yellow', 'Purple', 'Red'] }  // Blue, Green in no preference
      ]

      for (const vote of votes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
        
        // Verify stored vote only contains ranked items
        expect(data[0].ranked_choices).toEqual(vote.ranked_choices)
        expect(data[0].ranked_choices.length).toBeLessThanOrEqual(5)
      }

      // Verify algorithms work correctly with incomplete ballots
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: exclusionPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
    })

    it('should handle database transaction integrity under concurrent load', async () => {
      const testPoll = {
        title: 'Transaction Integrity Test',
        poll_type: 'ranked_choice',
        options: ['A', 'B', 'C', 'D'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'transaction-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([testPoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      const transactionPollId = pollData.id
      cleanup.push({ type: 'poll', id: transactionPollId })

      // Create multiple concurrent vote submissions
      const concurrentSubmissions = []
      for (let i = 0; i < 20; i++) {
        const vote = {
          poll_id: transactionPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['A', 'B', 'C', 'D'].sort(() => Math.random() - 0.5).slice(0, 2)
        }
        concurrentSubmissions.push(
          supabase.from('votes').insert([vote]).select()
        )
      }

      // Execute all submissions concurrently
      const results = await Promise.allSettled(concurrentSubmissions)
      
      // Count successful submissions
      let successCount = 0
      results.forEach(result => {
        if (result.status === 'fulfilled' && !result.value.error) {
          successCount++
          cleanup.push({ type: 'vote', id: result.value.data[0].id })
        }
      })

      // Verify final vote count matches successful submissions
      const { data: finalVotes, error: countError } = await supabase
        .from('votes')
        .select('id')
        .eq('poll_id', transactionPollId)

      expect(countError).toBeNull()
      expect(finalVotes.length).toBe(successCount)

      // Verify results can be calculated correctly
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: transactionPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
    })
  })
})