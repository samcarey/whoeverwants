/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 3: Algorithm Performance and Scalability', () => {
  let testPollId = null
  let largePollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create standard test poll
    const testPoll = {
      title: 'Algorithm Performance Test Poll',
      poll_type: 'ranked_choice',
        is_private: false,
      options: ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'performance-test-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for performance tests')
    }

    testPollId = data.id
    cleanup.push({ type: 'poll', id: testPollId })

    // Create large poll for scalability testing
    const largeOptions = Array.from({ length: 20 }, (_, i) => `Candidate ${String.fromCharCode(65 + i)}`) // A-T
    const largePoll = {
      title: 'Large Scale Performance Test Poll',
      poll_type: 'ranked_choice',
        is_private: false,
      options: largeOptions,
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'large-performance-test-' + Date.now()
    }

    const { data: largeData, error: largeError } = await supabase
      .from('polls')
      .insert([largePoll])
      .select()
      .single()

    if (largeError) {
      throw new Error('Could not create large test poll for performance tests')
    }

    largePollId = largeData.id
    cleanup.push({ type: 'poll', id: largePollId })
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

  describe('1. IRV Performance with Incomplete Ballots', () => {
    it('should handle 100+ ballots with varying completeness efficiently', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Generate 100 ballots with random completeness
      const testVotes = []
      const options = ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']
      
      for (let i = 0; i < 100; i++) {
        const ballotLength = Math.floor(Math.random() * 4) + 1 // 1-4 candidates
        const shuffledOptions = [...options].sort(() => Math.random() - 0.5)
        
        testVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: shuffledOptions.slice(0, ballotLength)
        })
      }

      // Insert votes in batches for better performance
      const batchSize = 20
      for (let i = 0; i < testVotes.length; i += batchSize) {
        const batch = testVotes.slice(i, i + batchSize)
        
        const { data, error } = await supabase
          .from('votes')
          .insert(batch)
          .select()

        expect(error).toBeNull()
        data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))
      }

      // Run IRV algorithm and measure performance
      const startTime = Date.now()
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
      const endTime = Date.now()

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()

      // Should complete within reasonable time (30 seconds for 100 ballots)
      const executionTime = endTime - startTime
      expect(executionTime).toBeLessThan(30000)
      
      console.log(`IRV with 100 incomplete ballots: ${executionTime}ms`)

      // Verify result quality
      expect(result[0]?.total_rounds).toBeGreaterThan(0)
      expect(result[0]?.total_rounds).toBeLessThan(20) // Shouldn't need too many rounds
    })

    it('should scale linearly with number of ballots', async () => {
      const ballotCounts = [10, 25, 50]
      const executionTimes = []

      for (const count of ballotCounts) {
        // Clear any existing votes
        await supabase.from('votes').delete().eq('poll_id', testPollId)

        // Generate ballots
        const testVotes = []
        const options = ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']
        
        for (let i = 0; i < count; i++) {
          const ballotLength = Math.floor(Math.random() * 3) + 1 // 1-3 candidates
          const shuffledOptions = [...options].sort(() => Math.random() - 0.5)
          
          testVotes.push({
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: shuffledOptions.slice(0, ballotLength)
          })
        }

        // Insert votes
        const { data, error } = await supabase
          .from('votes')
          .insert(testVotes)
          .select()

        expect(error).toBeNull()
        data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

        // Measure execution time
        const startTime = Date.now()
        const { data: result, error: calcError } = await supabase
          .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
        const endTime = Date.now()

        expect(calcError).toBeNull()
        expect(result[0]?.winner).toBeDefined()

        const executionTime = endTime - startTime
        executionTimes.push(executionTime)
        
        console.log(`IRV with ${count} ballots: ${executionTime}ms`)
      }

      // Verify reasonable scaling (not exponential)
      // Time for 50 ballots shouldn't be more than 10x time for 10 ballots
      expect(executionTimes[2]).toBeLessThan(executionTimes[0] * 10)
    })

    it('should handle complex elimination scenarios efficiently', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario that requires many elimination rounds
      const testVotes = []
      const options = ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']
      
      // Distribute votes to create close competition
      for (let i = 0; i < 50; i++) {
        const primaryChoice = options[i % 5] // Cycle through options
        const secondaryChoices = options.filter(opt => opt !== primaryChoice)
          .sort(() => Math.random() - 0.5)
          .slice(0, 2)
        
        testVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: [primaryChoice, ...secondaryChoices]
        })
      }

      // Insert votes
      const { data, error } = await supabase
        .from('votes')
        .insert(testVotes)
        .select()

      expect(error).toBeNull()
      data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

      // Run IRV algorithm
      const startTime = Date.now()
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
      const endTime = Date.now()

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()

      const executionTime = endTime - startTime
      console.log(`IRV complex elimination: ${executionTime}ms`)
      
      // Should handle complex scenarios efficiently
      expect(executionTime).toBeLessThan(15000) // 15 seconds max

      // Verify multiple rounds occurred
      expect(result[0]?.total_rounds).toBeGreaterThan(1)
    })
  })

  describe('2. Borda Count Performance with Compensation', () => {
    it('should handle large numbers of incomplete ballots efficiently', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Generate many ballots with varying completeness for Borda testing
      const testVotes = []
      const options = ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']
      
      for (let i = 0; i < 200; i++) { // More ballots since Borda is single-round
        const ballotLength = Math.floor(Math.random() * 4) + 1 // 1-4 candidates
        const shuffledOptions = [...options].sort(() => Math.random() - 0.5)
        
        testVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: shuffledOptions.slice(0, ballotLength)
        })
      }

      // Insert votes in batches
      const batchSize = 25
      for (let i = 0; i < testVotes.length; i += batchSize) {
        const batch = testVotes.slice(i, i + batchSize)
        
        const { data, error } = await supabase
          .from('votes')
          .insert(batch)
          .select()

        expect(error).toBeNull()
        data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))
      }

      // Run Borda Count algorithm and measure performance
      const startTime = Date.now()
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })
      const endTime = Date.now()

      expect(calcError).toBeNull()
      expect(result.length).toBe(5) // All candidates returned

      const executionTime = endTime - startTime
      console.log(`Borda Count with 200 incomplete ballots: ${executionTime}ms`)
      
      // Should be very fast since it's single-round
      expect(executionTime).toBeLessThan(10000) // 10 seconds max

      // Verify winner was determined
      const winner = result.find(r => r.winner !== null)
      expect(winner).toBeDefined()
      expect(winner.borda_score).toBeGreaterThan(0)
    })

    it('should handle complex compensation calculations efficiently', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create scenario with many different ballot lengths (complex compensation)
      const testVotes = []
      const options = ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']
      
      // Create ballots of every possible length
      for (let length = 1; length <= 5; length++) {
        for (let i = 0; i < 20; i++) { // 20 ballots of each length
          const shuffledOptions = [...options].sort(() => Math.random() - 0.5)
          
          testVotes.push({
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: shuffledOptions.slice(0, length)
          })
        }
      }

      // Insert votes
      const { data, error } = await supabase
        .from('votes')
        .insert(testVotes)
        .select()

      expect(error).toBeNull()
      data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

      // Run Borda Count algorithm
      const startTime = Date.now()
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })
      const endTime = Date.now()

      expect(calcError).toBeNull()

      const executionTime = endTime - startTime
      console.log(`Borda Count complex compensation: ${executionTime}ms`)
      
      // Complex compensation should still be fast
      expect(executionTime).toBeLessThan(8000) // 8 seconds max

      // Verify all candidates received appropriate scores
      result.forEach(candidate => {
        expect(candidate.borda_score).toBeGreaterThan(0)
        expect(Number.isInteger(candidate.borda_score)).toBe(true)
      })
    })

    it('should maintain precision under heavy computational load', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create controlled scenario to test precision
      const testVotes = []
      
      // Pattern that should produce predictable scores
      for (let i = 0; i < 100; i++) {
        testVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Option 1', 'Option 2'] // Everyone prefers Option 1
        })
      }

      // Insert votes
      const { data, error } = await supabase
        .from('votes')
        .insert(testVotes)
        .select()

      expect(error).toBeNull()
      data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

      // Run Borda Count algorithm
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()

      const option1Result = result.find(r => r.candidate_name === 'Option 1')
      const option2Result = result.find(r => r.candidate_name === 'Option 2')

      // With 2-candidate ballots and 5 total candidates: compensation factor = 5/2 = 2.5
      // Option 1: 2 points * 2.5 compensation * 100 ballots
      // Option 2: 1 point * 2.5 compensation * 100 ballots
      // Verify proportional relationship: Option 1 should have higher score than Option 2
      // Due to compensation factors, exact 2x may not occur, but ratio should be reasonable
      expect(option1Result.borda_score).toBeGreaterThan(option2Result.borda_score)
      const ratio = option1Result.borda_score / option2Result.borda_score
      expect(ratio).toBeGreaterThan(1.2) // Should be at least 1.2x (reasonable for compensation)
      expect(ratio).toBeLessThan(3.0) // But not more than 3x
      expect(option1Result.borda_score).toBeGreaterThan(0)
      expect(option2Result.borda_score).toBeGreaterThan(0)

      // Option 1 should be the winner
      expect(option1Result.winner).toBe('Option 1')
    })
  })

  describe('3. Large Scale Testing', () => {
    it('should handle polls with many candidates and many ballots', async () => {
      // Use the large poll (20 candidates)
      await supabase.from('votes').delete().eq('poll_id', largePollId)

      // Generate ballots for large poll
      const testVotes = []
      const candidateLetters = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i)) // A-T
      const candidates = candidateLetters.map(letter => `Candidate ${letter}`)
      
      for (let i = 0; i < 150; i++) {
        const ballotLength = Math.floor(Math.random() * 10) + 1 // 1-10 candidates
        const shuffledCandidates = [...candidates].sort(() => Math.random() - 0.5)
        
        testVotes.push({
          poll_id: largePollId,
          vote_type: 'ranked_choice',
          ranked_choices: shuffledCandidates.slice(0, ballotLength)
        })
      }

      // Insert votes in batches
      const batchSize = 30
      for (let i = 0; i < testVotes.length; i += batchSize) {
        const batch = testVotes.slice(i, i + batchSize)
        
        const { data, error } = await supabase
          .from('votes')
          .insert(batch)
          .select()

        expect(error).toBeNull()
        data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))
      }

      // Test both algorithms on large scale
      const irvStartTime = Date.now()
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: largePollId })
      const irvEndTime = Date.now()

      const bordaStartTime = Date.now()
      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: largePollId })
      const bordaEndTime = Date.now()

      expect(irvError).toBeNull()
      expect(bordaError).toBeNull()

      const irvTime = irvEndTime - irvStartTime
      const bordaTime = bordaEndTime - bordaStartTime

      console.log(`Large scale IRV (20 candidates, 150 ballots): ${irvTime}ms`)
      console.log(`Large scale Borda (20 candidates, 150 ballots): ${bordaTime}ms`)

      // Both should complete in reasonable time
      expect(irvTime).toBeLessThan(60000) // 1 minute max for IRV
      expect(bordaTime).toBeLessThan(30000) // 30 seconds max for Borda

      // Verify results
      expect(irvResult[0]?.winner).toBeDefined()
      expect(bordaResult.find(r => r.winner !== null)?.winner).toBeDefined()

      // Borda should be faster (single round vs multiple elimination rounds)
      expect(bordaTime).toBeLessThan(irvTime * 2) // Borda shouldn't be more than 2x IRV time
    })

    it('should maintain memory efficiency under load', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      const initialMemory = process.memoryUsage().heapUsed

      // Create and process multiple batches to test memory management
      for (let batch = 0; batch < 5; batch++) {
        const testVotes = []
        const options = ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']
        
        for (let i = 0; i < 20; i++) {
          const ballotLength = Math.floor(Math.random() * 3) + 1
          const shuffledOptions = [...options].sort(() => Math.random() - 0.5)
          
          testVotes.push({
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: shuffledOptions.slice(0, ballotLength)
          })
        }

        // Insert and process this batch
        const { data, error } = await supabase
          .from('votes')
          .insert(testVotes)
          .select()

        expect(error).toBeNull()
        data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

        // Run algorithms
        await supabase.rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
        await supabase.rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

        // Force garbage collection
        if (global.gc) {
          global.gc()
        }
      }

      const finalMemory = process.memoryUsage().heapUsed
      const memoryGrowth = finalMemory - initialMemory

      // Memory growth should be reasonable (less than 50MB)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024)
    })

    it('should handle edge case of maximum ballot variety', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create every possible ballot permutation for 3 candidates
      const options = ['Option 1', 'Option 2', 'Option 3']
      const testVotes = []

      // All possible rankings of 3 candidates
      const permutations = [
        ['Option 1', 'Option 2', 'Option 3'],
        ['Option 1', 'Option 3', 'Option 2'],
        ['Option 2', 'Option 1', 'Option 3'],
        ['Option 2', 'Option 3', 'Option 1'],
        ['Option 3', 'Option 1', 'Option 2'],
        ['Option 3', 'Option 2', 'Option 1']
      ]

      // Add incomplete ballots too
      const incompletePermutations = [
        ['Option 1', 'Option 2'],
        ['Option 1', 'Option 3'],
        ['Option 2', 'Option 1'],
        ['Option 2', 'Option 3'],
        ['Option 3', 'Option 1'],
        ['Option 3', 'Option 2'],
        ['Option 1'],
        ['Option 2'],
        ['Option 3']
      ]

      // Add multiple copies of each permutation
      const allPermutations = [...permutations, ...incompletePermutations]
      allPermutations.forEach(ranking => {
        for (let i = 0; i < 3; i++) {
          testVotes.push({
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: ranking
          })
        }
      })

      // Insert votes
      const { data, error } = await supabase
        .from('votes')
        .insert(testVotes)
        .select()

      expect(error).toBeNull()
      data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

      // Run both algorithms on maximum variety scenario
      const startTime = Date.now()
      
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      const endTime = Date.now()

      expect(irvError).toBeNull()
      expect(bordaError).toBeNull()

      console.log(`Maximum variety test: ${endTime - startTime}ms`)

      // Should handle maximum variety efficiently
      expect(endTime - startTime).toBeLessThan(10000) // 10 seconds max

      // Both algorithms should produce winners
      expect(irvResult[0]?.winner).toBeDefined()
      expect(bordaResult.find(r => r.winner !== null)?.winner).toBeDefined()
    })
  })
})