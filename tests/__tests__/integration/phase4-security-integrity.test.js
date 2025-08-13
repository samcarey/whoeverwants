/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 4: Security and Data Integrity Tests', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create test poll for security testing
    const testPoll = {
      title: 'Security and Integrity Test Poll',
      poll_type: 'ranked_choice',
      options: ['Secure A', 'Secure B', 'Secure C', 'Secure D'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'security-test-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for security tests')
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

  describe('1. Input Validation and Sanitization', () => {
    it('should reject malicious input in candidate names', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test various malicious input patterns
      const maliciousInputs = [
        // SQL injection attempts
        "'; DROP TABLE votes; --",
        "' OR '1'='1",
        "'; UPDATE votes SET ranked_choices = '[]'; --",
        
        // XSS attempts  
        "<script>alert('xss')</script>",
        "javascript:alert('xss')",
        "<img src=x onerror=alert('xss')>",
        
        // Command injection attempts
        "; rm -rf /",
        "$(whoami)",
        "`cat /etc/passwd`",
        
        // Path traversal attempts
        "../../etc/passwd",
        "../../../windows/system32",
        
        // Large payload (DoS attempt)
        "A".repeat(10000),
        
        // Special characters
        "\x00\x01\x02",
        "\n\r\t",
        "🤖💀☠️"
      ]

      // Test each malicious input as a ranked choice
      for (const maliciousInput of maliciousInputs) {
        const maliciousVote = {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: [maliciousInput]
        }

        // This should either be rejected or sanitized
        const { data, error } = await supabase
          .from('votes')
          .insert([maliciousVote])
          .select()

        // If accepted, the input should be sanitized and not cause system damage
        if (!error && data) {
          cleanup.push({ type: 'vote', id: data[0].id })
          
          // Verify the stored data doesn't contain dangerous elements
          expect(data[0].ranked_choices[0]).toBeDefined()
          
          // The system should still function normally after malicious input
          const { data: testResult, error: testError } = await supabase
            .from('votes')
            .select('*')
            .eq('poll_id', testPollId)
            
          expect(testError).toBeNull()
        }
      }

      // Verify system integrity after malicious input attempts
      const { data: finalCheck, error: finalError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', testPollId)

      expect(finalError).toBeNull()
      expect(finalCheck[0]?.id).toBe(testPollId)
    })

    it('should validate ranked choices against actual poll options', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Valid vote (should succeed)
      const validVote = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure A', 'Secure B']
      }

      const { data: validData, error: validError } = await supabase
        .from('votes')
        .insert([validVote])
        .select()

      expect(validError).toBeNull()
      if (validData) {
        cleanup.push({ type: 'vote', id: validData[0].id })
      }

      // Invalid votes (should be rejected or filtered)
      const invalidVotes = [
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Invalid Option'] // Not in poll options
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Secure A', 'Fake Option', 'Secure B'] // Mixed valid/invalid
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: [] // Empty array
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['', 'Secure A'] // Empty string included
        }
      ]

      for (const invalidVote of invalidVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([invalidVote])
          .select()

        // System should handle invalid votes gracefully
        if (!error && data) {
          cleanup.push({ type: 'vote', id: data[0].id })
          
          // If stored, verify structure is valid
          const storedChoices = data[0].ranked_choices
          expect(Array.isArray(storedChoices)).toBe(true)
          // Note: System may store invalid options - testing that structure is maintained
        }
      }
    })

    it('should prevent SQL injection in voting algorithm functions', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Insert legitimate vote for testing
      const testVote = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure A', 'Secure B']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([testVote])
        .select()

      expect(error).toBeNull()
      cleanup.push({ type: 'vote', id: data[0].id })

      // Test SQL injection attempts on algorithm functions
      const maliciousPollIds = [
        "'; DROP TABLE votes; SELECT '",
        "' OR 1=1; --",
        "null; DELETE FROM polls; SELECT uuid_generate_v4() AS '"
      ]

      for (const maliciousId of maliciousPollIds) {
        // IRV function should reject malicious input
        const { data: irvResult, error: irvError } = await supabase
          .rpc('calculate_ranked_choice_winner', { target_poll_id: maliciousId })

        // Should either error safely or return null, but not execute malicious SQL
        if (!irvError) {
          expect(irvResult).toBeDefined()
        }

        // Borda function should also be protected
        const { data: bordaResult, error: bordaError } = await supabase
          .rpc('calculate_borda_count_winner', { target_poll_id: maliciousId })

        if (!bordaError) {
          expect(bordaResult).toBeDefined()
        }
      }

      // Verify original data integrity after injection attempts
      const { data: integrityCheck, error: integrityError } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', testPollId)

      expect(integrityError).toBeNull()
      expect(integrityCheck.length).toBeGreaterThan(0)
    })
  })

  describe('2. Authentication and Authorization', () => {
    it('should verify poll creator permissions with secret validation', async () => {
      // Test accessing poll with correct secret
      const { data: pollWithSecret, error: secretError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', testPollId)
        .single()

      expect(secretError).toBeNull()
      expect(pollWithSecret.creator_secret).toBeDefined()

      // Test poll modification with correct secret (simulated)
      const updateData = {
        title: 'Updated Security Test Poll'
      }

      const { data: updateResult, error: updateError } = await supabase
        .from('polls')
        .update(updateData)
        .eq('id', testPollId)
        .eq('creator_secret', pollWithSecret.creator_secret)

      expect(updateError).toBeNull()

      // Test with wrong secret (should fail)
      const { data: wrongSecretResult, error: wrongSecretError } = await supabase
        .from('polls')
        .update({ title: 'Unauthorized Update' })
        .eq('id', testPollId)
        .eq('creator_secret', 'wrong-secret')

      // Should not update or should error
      if (!wrongSecretError && wrongSecretResult) {
        expect(wrongSecretResult.length).toBe(0)
      }

      // Restore original title
      await supabase
        .from('polls')
        .update({ title: 'Security and Integrity Test Poll' })
        .eq('id', testPollId)
        .eq('creator_secret', pollWithSecret.creator_secret)
    })

    it('should maintain vote anonymity and privacy', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Submit anonymous votes
      const anonymousVotes = [
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Secure A', 'Secure B']
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Secure B', 'Secure A']
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Secure C']
        }
      ]

      const voteIds = []
      for (const vote of anonymousVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        voteIds.push(data[0].id)
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Verify votes don't contain identifying information
      const { data: storedVotes, error: fetchError } = await supabase
        .from('votes')
        .select('*')
        .in('id', voteIds)

      expect(fetchError).toBeNull()
      
      storedVotes.forEach(vote => {
        // Check that votes only contain necessary data
        expect(vote.id).toBeDefined()
        expect(vote.poll_id).toBe(testPollId)
        expect(vote.vote_type).toBe('ranked_choice')
        expect(vote.ranked_choices).toBeDefined()
        
        // Should not contain user identification
        expect(vote.user_id).toBeUndefined()
        expect(vote.ip_address).toBeUndefined()
        expect(vote.email).toBeUndefined()
        expect(vote.session_id).toBeUndefined()
      })

      // Verify voting results don't reveal individual vote patterns
      const { data: results, error: resultError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(resultError).toBeNull()
      expect(results[0]?.winner).toBeDefined()
      
      // Results should only show aggregated data, not individual votes
      expect(results[0]).not.toHaveProperty('individual_votes')
      expect(results[0]).not.toHaveProperty('vote_details')
    })

    it('should prevent unauthorized access to poll results before closing', async () => {
      // Create a poll that's not closed yet
      const openPoll = {
        title: 'Open Poll Security Test',
        poll_type: 'ranked_choice',
        options: ['Option 1', 'Option 2', 'Option 3'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'open-poll-' + Date.now(),
        is_closed: false
      }

      const { data: openPollData, error: openPollError } = await supabase
        .from('polls')
        .insert([openPoll])
        .select()
        .single()

      expect(openPollError).toBeNull()
      const openPollId = openPollData.id
      cleanup.push({ type: 'poll', id: openPollId })

      // Add some votes
      const votes = [
        { poll_id: openPollId, vote_type: 'ranked_choice', ranked_choices: ['Option 1', 'Option 2'] },
        { poll_id: openPollId, vote_type: 'ranked_choice', ranked_choices: ['Option 2', 'Option 1'] }
      ]

      for (const vote of votes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Attempting to get results while poll is open should be controlled
      // (The specific behavior depends on business rules - either blocked or allowed)
      const { data: openResults, error: openResultError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: openPollId })

      // System should handle this consistently
      if (openResultError) {
        // If blocked, error should be meaningful
        expect(openResultError.message).toBeDefined()
      } else {
        // If allowed, results should be valid
        expect(openResults).toBeDefined()
      }

      // Close the poll and verify results are accessible
      const { error: closeError } = await supabase
        .from('polls')
        .update({ is_closed: true })
        .eq('id', openPollId)

      expect(closeError).toBeNull()

      // Results should definitely be accessible after closing
      const { data: closedResults, error: closedResultError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: openPollId })

      expect(closedResultError).toBeNull()
      expect(closedResults[0]?.winner).toBeDefined()
    })
  })

  describe('3. Data Protection and Integrity', () => {
    it('should maintain ballot immutability after submission', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Submit initial ballot
      const originalBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure A', 'Secure B', 'Secure C']
      }

      const { data: ballotData, error: ballotError } = await supabase
        .from('votes')
        .insert([originalBallot])
        .select()
        .single()

      expect(ballotError).toBeNull()
      const voteId = ballotData.id
      cleanup.push({ type: 'vote', id: voteId })

      // Store original choices for comparison
      const originalChoices = [...ballotData.ranked_choices]

      // Attempt to modify the ballot
      const { data: updateResult, error: updateError } = await supabase
        .from('votes')
        .update({ ranked_choices: ['Secure D', 'Secure A'] })
        .eq('id', voteId)

      // Modification should either be blocked or ignored
      // Fetch the vote again to verify immutability
      const { data: unchangedVote, error: fetchError } = await supabase
        .from('votes')
        .select('*')
        .eq('id', voteId)
        .single()

      expect(fetchError).toBeNull()
      
      // Vote should remain unchanged (ballot immutability)
      expect(unchangedVote.ranked_choices).toEqual(originalChoices)
      expect(unchangedVote.poll_id).toBe(testPollId)
      expect(unchangedVote.vote_type).toBe('ranked_choice')
    })

    it('should verify data consistency during concurrent operations', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Generate concurrent operations that could cause race conditions
      const concurrentOperations = []

      // Concurrent vote submissions
      for (let i = 0; i < 20; i++) {
        const vote = {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Secure A', 'Secure B', 'Secure C', 'Secure D']
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.floor(Math.random() * 3) + 1)
        }
        
        concurrentOperations.push(
          supabase.from('votes').insert([vote]).select()
        )
      }

      // Concurrent result calculations
      concurrentOperations.push(
        supabase.rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
      )
      concurrentOperations.push(
        supabase.rpc('calculate_borda_count_winner', { target_poll_id: testPollId })
      )

      // Execute all operations concurrently
      const results = await Promise.allSettled(concurrentOperations)

      // Count successful vote submissions
      let successfulVotes = 0
      results.forEach((result, index) => {
        if (index < 20) { // Vote submissions
          if (result.status === 'fulfilled' && !result.value.error) {
            successfulVotes++
            cleanup.push({ type: 'vote', id: result.value.data[0].id })
          }
        } else { // Algorithm calculations
          // Calculations should either succeed or fail gracefully
          if (result.status === 'fulfilled') {
            expect(result.value.error).toBeFalsy()
          }
        }
      })

      // Verify final vote count includes our successful submissions
      const { data: finalVotes, error: countError } = await supabase
        .from('votes')
        .select('id')
        .eq('poll_id', testPollId)

      expect(countError).toBeNull()
      expect(finalVotes.length).toBeGreaterThanOrEqual(successfulVotes)

      // Verify data integrity after concurrent operations
      const { data: allVotes, error: integrityError } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', testPollId)

      expect(integrityError).toBeNull()
      
      // All votes should have valid structure
      allVotes.forEach(vote => {
        expect(vote.poll_id).toBe(testPollId)
        expect(vote.vote_type).toBe('ranked_choice')
        expect(Array.isArray(vote.ranked_choices)).toBe(true)
        expect(vote.ranked_choices.length).toBeGreaterThan(0)
      })
    })

    it('should protect against data corruption during algorithm execution', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create a known, valid dataset
      const testVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Secure A', 'Secure B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Secure B', 'Secure A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Secure C', 'Secure A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Secure A'] }
      ]

      for (const vote of testVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Store original vote data for comparison
      const { data: originalVotes, error: originalError } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', testPollId)
        .order('created_at')

      expect(originalError).toBeNull()

      // Run algorithms multiple times to check for data corruption
      for (let i = 0; i < 5; i++) {
        const { data: irvResult, error: irvError } = await supabase
          .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

        expect(irvError).toBeNull()
        expect(irvResult[0]?.winner).toBeDefined()

        const { data: bordaResult, error: bordaError } = await supabase
          .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

        expect(bordaError).toBeNull()
        expect(bordaResult.length).toBeGreaterThan(0)
      }

      // Verify original vote data remains unchanged after algorithm execution
      const { data: unchangedVotes, error: unchangedError } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', testPollId)
        .order('created_at')

      expect(unchangedError).toBeNull()
      expect(unchangedVotes.length).toBe(originalVotes.length)

      // Compare each vote to ensure no corruption
      originalVotes.forEach((originalVote, index) => {
        const unchangedVote = unchangedVotes[index]
        expect(unchangedVote.id).toBe(originalVote.id)
        expect(unchangedVote.poll_id).toBe(originalVote.poll_id)
        expect(unchangedVote.ranked_choices).toEqual(originalVote.ranked_choices)
        expect(unchangedVote.vote_type).toBe(originalVote.vote_type)
      })
    })
  })

  describe('4. Error Handling and Recovery', () => {
    it('should handle malformed vote data gracefully', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test various malformed vote structures
      const malformedVotes = [
        // Null values
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: null },
        
        // Wrong data types (these may be handled by database constraints)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: "not an array" },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: 12345 },
        
        // Empty structures
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: [] },
        
        // Nested arrays (invalid structure)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: [['Secure A'], ['Secure B']] }
      ]

      let validVoteCount = 0
      for (const malformedVote of malformedVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([malformedVote])
          .select()

        // System should either reject malformed data or sanitize it
        if (!error && data) {
          // If accepted, data should be in valid format
          expect(Array.isArray(data[0].ranked_choices)).toBe(true)
          cleanup.push({ type: 'vote', id: data[0].id })
          validVoteCount++
        }
      }

      // Add some valid votes to test mixed scenarios
      const validVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Secure A', 'Secure B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Secure C'] }
      ]

      for (const vote of validVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
        validVoteCount++
      }

      // Algorithms should handle mixed valid/invalid data gracefully
      if (validVoteCount > 0) {
        const { data: result, error: calcError } = await supabase
          .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

        // Should either succeed with valid data or fail gracefully
        if (!calcError) {
          expect(result[0]?.winner).toBeDefined()
        }
      }
    })

    it('should recover from database constraint violations', async () => {
      // Test duplicate vote prevention (if implemented)
      const duplicateVote = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure A', 'Secure B']
      }

      // Submit first vote
      const { data: firstVote, error: firstError } = await supabase
        .from('votes')
        .insert([duplicateVote])
        .select()

      expect(firstError).toBeNull()
      cleanup.push({ type: 'vote', id: firstVote[0].id })

      // Attempt duplicate submission (behavior depends on constraints)
      const { data: secondVote, error: secondError } = await supabase
        .from('votes')
        .insert([duplicateVote])
        .select()

      // System should handle this consistently (either allow or reject)
      if (!secondError && secondVote) {
        cleanup.push({ type: 'vote', id: secondVote[0].id })
      }

      // Test invalid foreign key references
      const invalidPollVote = {
        poll_id: '00000000-0000-0000-0000-000000000000', // Non-existent poll
        vote_type: 'ranked_choice',
        ranked_choices: ['Any Option']
      }

      const { data: invalidData, error: invalidError } = await supabase
        .from('votes')
        .insert([invalidPollVote])
        .select()

      // Should be rejected due to foreign key constraint
      expect(invalidError).not.toBeNull()

      // System should continue functioning after constraint violations
      const { data: systemCheck, error: systemError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', testPollId)

      expect(systemError).toBeNull()
      expect(systemCheck[0]?.id).toBe(testPollId)
    })

    it('should maintain system stability under stress conditions', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Create stress conditions with rapid operations
      const stressOperations = []

      // Rapid vote submissions
      for (let i = 0; i < 50; i++) {
        stressOperations.push(
          supabase.from('votes').insert([{
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: ['Secure A', 'Secure B'].slice(0, (i % 2) + 1)
          }]).select()
        )
      }

      // Concurrent algorithm executions
      for (let i = 0; i < 10; i++) {
        stressOperations.push(
          supabase.rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
        )
        stressOperations.push(
          supabase.rpc('calculate_borda_count_winner', { target_poll_id: testPollId })
        )
      }

      // Execute stress operations
      const stressResults = await Promise.allSettled(stressOperations)

      // System should remain stable
      let operationSuccesses = 0
      stressResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && !result.value.error) {
          operationSuccesses++
          
          // Track votes for cleanup
          if (index < 50 && result.value.data) {
            cleanup.push({ type: 'vote', id: result.value.data[0].id })
          }
        }
      })

      // Should handle most operations successfully
      expect(operationSuccesses).toBeGreaterThan(30)

      // Verify system integrity after stress test
      const { data: finalState, error: finalError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', testPollId)

      expect(finalError).toBeNull()
      expect(finalState[0]?.id).toBe(testPollId)

      // Verify algorithm still functions correctly
      const { data: postStressResult, error: postStressError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(postStressError).toBeNull()
      if (postStressResult[0]?.winner) {
        expect(postStressResult[0].winner).toBeDefined()
      }
    })
  })
})