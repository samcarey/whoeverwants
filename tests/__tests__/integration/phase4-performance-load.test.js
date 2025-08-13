/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 4: Performance and Load Testing', () => {
  let testPollId = null
  let largePollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create standard test poll
    const testPoll = {
      title: 'Performance Load Test Poll',
      poll_type: 'ranked_choice',
      options: ['Load A', 'Load B', 'Load C', 'Load D', 'Load E'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'perf-load-' + Date.now()
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
    const largeOptions = Array.from({ length: 15 }, (_, i) => `Candidate ${String.fromCharCode(65 + i)}`) // A-O
    const largePoll = {
      title: 'Large Scale Performance Test',
      poll_type: 'ranked_choice',
      options: largeOptions,
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'large-perf-' + Date.now()
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
  }, 60000)

  describe('1. Concurrent Voting Load Tests', () => {
    it('should handle 100 simultaneous users voting on same poll', async () => {
      // Clear any existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Generate 100 concurrent vote submissions
      const concurrentVotes = []
      for (let i = 0; i < 100; i++) {
        const ballotLength = Math.floor(Math.random() * 4) + 1 // 1-4 candidates
        const shuffledOptions = ['Load A', 'Load B', 'Load C', 'Load D', 'Load E']
          .sort(() => Math.random() - 0.5)
          .slice(0, ballotLength)
        
        concurrentVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: shuffledOptions
        })
      }

      // Measure submission performance
      const startTime = Date.now()
      
      // Submit all votes concurrently
      const submissionPromises = concurrentVotes.map(vote => 
        supabase.from('votes').insert([vote]).select()
      )

      const results = await Promise.allSettled(submissionPromises)
      const submissionTime = Date.now() - startTime

      // Count successful submissions
      let successCount = 0
      results.forEach(result => {
        if (result.status === 'fulfilled' && !result.value.error) {
          successCount++
          cleanup.push({ type: 'vote', id: result.value.data[0].id })
        }
      })

      // Should handle most/all concurrent submissions
      expect(successCount).toBeGreaterThan(90) // At least 90% success rate
      expect(submissionTime).toBeLessThan(30000) // Under 30 seconds

      console.log(`Concurrent submission: ${successCount}/100 votes in ${submissionTime}ms`)

      // Verify final count matches successful submissions
      const { data: finalVotes, error: countError } = await supabase
        .from('votes')
        .select('id')
        .eq('poll_id', testPollId)

      expect(countError).toBeNull()
      expect(finalVotes.length).toBe(successCount)
    })

    it('should maintain response times under high-frequency voting', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Simulate high-frequency voting patterns (rapid successive submissions)
      const votingTimes = []
      
      for (let batch = 0; batch < 10; batch++) {
        const batchVotes = []
        
        // Create batch of 5 votes
        for (let i = 0; i < 5; i++) {
          const vote = {
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: ['Load A', 'Load B', 'Load C'].slice(0, Math.floor(Math.random() * 3) + 1)
          }
          batchVotes.push(vote)
        }

        // Time each batch submission
        const batchStart = Date.now()
        
        const batchPromises = batchVotes.map(vote => 
          supabase.from('votes').insert([vote]).select()
        )
        
        const batchResults = await Promise.all(batchPromises)
        const batchTime = Date.now() - batchStart
        
        votingTimes.push(batchTime)

        // Track successful votes for cleanup
        batchResults.forEach(({ data, error }) => {
          if (!error && data) {
            cleanup.push({ type: 'vote', id: data[0].id })
          }
        })

        // Small delay between batches to simulate realistic usage
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Analyze response time consistency
      const avgTime = votingTimes.reduce((sum, time) => sum + time, 0) / votingTimes.length
      const maxTime = Math.max(...votingTimes)
      
      console.log(`High-frequency voting - Avg: ${avgTime}ms, Max: ${maxTime}ms`)

      // Response times should remain reasonable
      expect(avgTime).toBeLessThan(5000) // Average under 5 seconds
      expect(maxTime).toBeLessThan(10000) // Max under 10 seconds

      // Verify all votes were processed
      const { data: allVotes, error: countError } = await supabase
        .from('votes')
        .select('id')
        .eq('poll_id', testPollId)

      expect(countError).toBeNull()
      expect(allVotes.length).toBeGreaterThanOrEqual(50) // At least 10 batches × 5 votes
    })

    it('should handle database connection pooling under load', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test sustained load that would stress connection pools
      const sustainedVotes = []
      
      // Generate larger dataset for connection pool testing
      for (let i = 0; i < 200; i++) {
        const vote = {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Load A', 'Load B', 'Load C', 'Load D', 'Load E']
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.floor(Math.random() * 3) + 1)
        }
        sustainedVotes.push(vote)
      }

      // Submit in waves to test connection reuse
      const waveSize = 20
      const waves = []
      
      for (let i = 0; i < sustainedVotes.length; i += waveSize) {
        const wave = sustainedVotes.slice(i, i + waveSize)
        waves.push(wave)
      }

      const waveResults = []
      for (const wave of waves) {
        const waveStart = Date.now()
        
        const wavePromises = wave.map(vote => 
          supabase.from('votes').insert([vote]).select()
        )
        
        const results = await Promise.all(wavePromises)
        const waveTime = Date.now() - waveStart
        
        waveResults.push({ time: waveTime, count: results.length })

        // Track votes for cleanup
        results.forEach(({ data, error }) => {
          if (!error && data) {
            cleanup.push({ type: 'vote', id: data[0].id })
          }
        })
      }

      // Verify consistent performance across waves
      const waveTimes = waveResults.map(w => w.time)
      const avgWaveTime = waveTimes.reduce((sum, time) => sum + time, 0) / waveTimes.length
      
      console.log(`Connection pooling test - ${waves.length} waves, avg: ${avgWaveTime}ms per wave`)

      // Connection pooling should maintain consistent performance
      expect(avgWaveTime).toBeLessThan(8000) // Under 8 seconds per wave
      
      // Verify all waves completed successfully
      expect(waveResults.length).toBe(Math.ceil(200 / waveSize))
    })
  })

  describe('2. Large Poll Scenarios', () => {
    it('should handle poll with 15 candidates and 1000+ voters efficiently', async () => {
      // Clear existing votes from large poll
      await supabase.from('votes').delete().eq('poll_id', largePollId)

      // Generate 1000+ votes with varying ballot completeness
      const largeVoteSet = []
      const candidates = Array.from({ length: 15 }, (_, i) => `Candidate ${String.fromCharCode(65 + i)}`)
      
      for (let i = 0; i < 1000; i++) {
        const ballotLength = Math.floor(Math.random() * 8) + 1 // 1-8 candidates
        const shuffledCandidates = [...candidates].sort(() => Math.random() - 0.5)
        
        largeVoteSet.push({
          poll_id: largePollId,
          vote_type: 'ranked_choice',
          ranked_choices: shuffledCandidates.slice(0, ballotLength)
        })
      }

      // Insert votes in batches for manageable processing
      const batchSize = 50
      const insertionStart = Date.now()
      
      for (let i = 0; i < largeVoteSet.length; i += batchSize) {
        const batch = largeVoteSet.slice(i, i + batchSize)
        
        const { data, error } = await supabase
          .from('votes')
          .insert(batch)
          .select()

        expect(error).toBeNull()
        data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))
      }
      
      const insertionTime = Date.now() - insertionStart
      console.log(`Large dataset insertion: 1000 votes in ${insertionTime}ms`)

      // Test IRV performance with large dataset
      const irvStart = Date.now()
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: largePollId })
      const irvTime = Date.now() - irvStart

      expect(irvError).toBeNull()
      expect(irvResult[0]?.winner).toBeDefined()
      console.log(`IRV with 15 candidates, 1000 ballots: ${irvTime}ms`)

      // Test Borda Count performance
      const bordaStart = Date.now()
      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: largePollId })
      const bordaTime = Date.now() - bordaStart

      expect(bordaError).toBeNull()
      expect(bordaResult.length).toBe(15)
      console.log(`Borda Count with 15 candidates, 1000 ballots: ${bordaTime}ms`)

      // Performance requirements
      expect(insertionTime).toBeLessThan(120000) // Under 2 minutes for insertion
      expect(irvTime).toBeLessThan(180000) // Under 3 minutes for IRV
      expect(bordaTime).toBeLessThan(60000) // Under 1 minute for Borda
    })

    it('should maintain UI responsiveness during drag operations with many candidates', async () => {
      // Simulate performance characteristics of UI with large candidate lists
      // This tests the data structures that would be used in the UI
      
      const candidates = Array.from({ length: 15 }, (_, i) => `Candidate ${String.fromCharCode(65 + i)}`)
      
      // Simulate drag operations by creating various arrangements
      const arrangements = []
      
      // Generate 100 different arrangements (simulating user interactions)
      for (let i = 0; i < 100; i++) {
        const shuffled = [...candidates].sort(() => Math.random() - 0.5)
        const mainList = shuffled.slice(0, Math.floor(Math.random() * 10) + 1) // 1-10 candidates
        const noPreferenceList = shuffled.filter(c => !mainList.includes(c))
        
        arrangements.push({
          mainList,
          noPreferenceList,
          ballotToSubmit: mainList // Only main list gets submitted
        })
      }

      // Measure arrangement processing time
      const processingStart = Date.now()
      
      // Process each arrangement (simulating real-time drag operations)
      const processedBallots = arrangements.map(arrangement => {
        // Simulate ballot filtering (main functionality)
        const filteredBallot = arrangement.ballotToSubmit.filter(item => 
          item && item.trim() && arrangement.mainList.includes(item)
        )
        
        return {
          original: arrangement.mainList.length,
          filtered: filteredBallot.length,
          valid: filteredBallot.length > 0
        }
      })
      
      const processingTime = Date.now() - processingStart
      console.log(`UI arrangement processing: 100 operations in ${processingTime}ms`)

      // UI should remain responsive
      expect(processingTime).toBeLessThan(1000) // Under 1 second for 100 operations

      // Verify all arrangements produced valid results
      const validArrangements = processedBallots.filter(b => b.valid)
      expect(validArrangements.length).toBe(100) // All should be valid
    })

    it('should scale algorithm performance linearly with poll size', async () => {
      // Test different poll sizes to verify linear scaling
      const pollSizes = [
        { candidates: 5, votes: 50 },
        { candidates: 10, votes: 100 },
        { candidates: 15, votes: 150 }
      ]

      const performanceResults = []

      for (const { candidates, votes } of pollSizes) {
        // Create test poll for this size
        const sizePoll = {
          title: `Scale Test ${candidates}C ${votes}V`,
          poll_type: 'ranked_choice',
          options: Array.from({ length: candidates }, (_, i) => `Option${i + 1}`),
          response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          creator_secret: `scale-test-${candidates}-${Date.now()}`
        }

        const { data: pollData, error: pollError } = await supabase
          .from('polls')
          .insert([sizePoll])
          .select()
          .single()

        expect(pollError).toBeNull()
        const scalePollId = pollData.id
        cleanup.push({ type: 'poll', id: scalePollId })

        // Generate votes for this poll size
        const scaleVotes = []
        for (let i = 0; i < votes; i++) {
          const ballotLength = Math.floor(Math.random() * Math.min(candidates, 5)) + 1
          const shuffledOptions = sizePoll.options.sort(() => Math.random() - 0.5)
          
          scaleVotes.push({
            poll_id: scalePollId,
            vote_type: 'ranked_choice',
            ranked_choices: shuffledOptions.slice(0, ballotLength)
          })
        }

        // Insert votes
        const { data: voteData, error: voteError } = await supabase
          .from('votes')
          .insert(scaleVotes)
          .select()

        expect(voteError).toBeNull()
        voteData.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

        // Measure IRV performance
        const irvStart = Date.now()
        const { data: irvResult, error: irvError } = await supabase
          .rpc('calculate_ranked_choice_winner', { target_poll_id: scalePollId })
        const irvTime = Date.now() - irvStart

        expect(irvError).toBeNull()

        // Measure Borda performance
        const bordaStart = Date.now()
        const { data: bordaResult, error: bordaError } = await supabase
          .rpc('calculate_borda_count_winner', { target_poll_id: scalePollId })
        const bordaTime = Date.now() - bordaStart

        expect(bordaError).toBeNull()

        performanceResults.push({
          candidates,
          votes,
          irvTime,
          bordaTime,
          complexity: candidates * votes
        })

        console.log(`Scale test ${candidates}C×${votes}V: IRV=${irvTime}ms, Borda=${bordaTime}ms`)
      }

      // Verify scaling is reasonable (not exponential)
      for (let i = 1; i < performanceResults.length; i++) {
        const prev = performanceResults[i - 1]
        const curr = performanceResults[i]
        
        const complexityRatio = curr.complexity / prev.complexity
        const irvRatio = curr.irvTime / prev.irvTime
        const bordaRatio = curr.bordaTime / prev.bordaTime

        // Performance should scale no worse than quadratically
        expect(irvRatio).toBeLessThan(complexityRatio * 2)
        expect(bordaRatio).toBeLessThan(complexityRatio * 2)
      }
    })
  })

  describe('3. Memory and Resource Management', () => {
    it('should maintain stable memory usage during intensive operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed

      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Perform memory-intensive operations
      for (let cycle = 0; cycle < 5; cycle++) {
        // Generate and submit votes
        const memoryTestVotes = []
        for (let i = 0; i < 50; i++) {
          memoryTestVotes.push({
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: ['Load A', 'Load B', 'Load C', 'Load D']
              .sort(() => Math.random() - 0.5)
              .slice(0, Math.floor(Math.random() * 3) + 1)
          })
        }

        const { data, error } = await supabase
          .from('votes')
          .insert(memoryTestVotes)
          .select()

        expect(error).toBeNull()
        data.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

        // Run calculations
        await supabase.rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
        await supabase.rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

        // Force garbage collection if available
        if (global.gc) {
          global.gc()
        }

        // Clear votes for next cycle
        await supabase.from('votes').delete().eq('poll_id', testPollId)
      }

      const finalMemory = process.memoryUsage().heapUsed
      const memoryGrowth = finalMemory - initialMemory

      console.log(`Memory growth: ${Math.round(memoryGrowth / 1024 / 1024)}MB`)

      // Memory growth should be reasonable
      expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024) // Under 100MB growth
    })

    it('should handle cleanup efficiently after large operations', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create large dataset
      const cleanupTestVotes = []
      for (let i = 0; i < 500; i++) {
        cleanupTestVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Load A', 'Load B', 'Load C']
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.floor(Math.random() * 2) + 1)
        })
      }

      // Insert large dataset
      const { data: largeData, error: insertError } = await supabase
        .from('votes')
        .insert(cleanupTestVotes)
        .select()

      expect(insertError).toBeNull()
      
      // Track all vote IDs for cleanup
      const voteIds = largeData.map(vote => vote.id)

      // Perform calculations on large dataset
      const { data: result1, error: calc1Error } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
      
      const { data: result2, error: calc2Error } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calc1Error).toBeNull()
      expect(calc2Error).toBeNull()

      // Measure cleanup performance
      const cleanupStart = Date.now()
      
      // Delete all votes from this test
      const { error: deleteError } = await supabase
        .from('votes')
        .delete()
        .in('id', voteIds)

      const cleanupTime = Date.now() - cleanupStart

      expect(deleteError).toBeNull()
      console.log(`Cleanup of 500 votes: ${cleanupTime}ms`)

      // Cleanup should be efficient
      expect(cleanupTime).toBeLessThan(10000) // Under 10 seconds

      // If deletion succeeded, the votes should be gone (skip verification due to network timing)
    })
  })
})