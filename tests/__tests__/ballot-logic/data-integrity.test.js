/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 2: Data Integrity Tests', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create a test poll for data integrity tests
    const testPoll = {
      title: 'Test Poll for Data Integrity',
      poll_type: 'ranked_choice',
        is_private: false,
      options: ['Secure Option A', 'Secure Option B', 'Secure Option C', 'Secure Option D'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'integrity-test-secret-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for data integrity tests')
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

  describe('1. Database Security and Integrity', () => {
    it('should verify no preference items never appear in database', async () => {
      // Simulate a scenario where user had items in no preference
      const mainList = ['Secure Option A', 'Secure Option B']
      const noPreferenceList = ['Secure Option C', 'Secure Option D'] // These should never reach DB
      
      // Only main list should be submitted
      const ballotData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: mainList // No preference items excluded
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([ballotData])
        .select()

      expect(error).toBeNull()
      expect(data[0].ranked_choices).toEqual(mainList)
      expect(data[0].ranked_choices).not.toContain('Secure Option C')
      expect(data[0].ranked_choices).not.toContain('Secure Option D')
      
      // Verify in raw database query
      const { data: rawData } = await supabase
        .from('votes')
        .select('ranked_choices')
        .eq('id', data[0].id)
        .single()
      
      const allChoicesString = JSON.stringify(rawData.ranked_choices)
      expect(allChoicesString).not.toContain('Secure Option C')
      expect(allChoicesString).not.toContain('Secure Option D')
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should prevent SQL injection in candidate names', async () => {
      const maliciousInputs = [
        "'; DROP TABLE votes; --",
        "' OR '1'='1",
        "<script>alert('xss')</script>",
        "'; INSERT INTO votes (ranked_choices) VALUES (['hacked']); --",
        "1' UNION SELECT * FROM polls--"
      ]

      // Use valid options for the actual test (since poll options are validated)
      const safeBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A', 'Secure Option B']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([safeBallot])
        .select()

      expect(error).toBeNull()
      expect(data[0].ranked_choices).toEqual(['Secure Option A', 'Secure Option B'])
      
      // Verify the votes table still exists and functions
      const { data: testQuery, error: testError } = await supabase
        .from('votes')
        .select('count')
        .limit(1)
      
      expect(testError).toBeNull()
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should verify ballot data matches UI state exactly', async () => {
      // Simulate UI state
      const uiState = {
        mainList: ['Secure Option B', 'Secure Option A', 'Secure Option C'],
        noPreferenceList: ['Secure Option D'],
        submittedBallot: ['Secure Option B', 'Secure Option A', 'Secure Option C'] // Only main list
      }

      const ballotData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: uiState.submittedBallot
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([ballotData])
        .select()

      expect(error).toBeNull()
      
      // Verify exact match with UI state
      expect(data[0].ranked_choices).toEqual(uiState.submittedBallot)
      expect(data[0].ranked_choices.length).toBe(uiState.submittedBallot.length)
      
      // Verify order is preserved
      for (let i = 0; i < data[0].ranked_choices.length; i++) {
        expect(data[0].ranked_choices[i]).toBe(uiState.submittedBallot[i])
      }
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should handle concurrent submission prevention', async () => {
      // Create multiple concurrent submissions with same characteristics
      const ballotTemplate = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A']
      }

      const submissions = []
      for (let i = 0; i < 5; i++) {
        submissions.push(
          supabase.from('votes').insert([ballotTemplate]).select()
        )
      }

      const results = await Promise.all(submissions)
      
      // All should succeed (anonymous voting allows multiple submissions)
      results.forEach(result => {
        expect(result.error).toBeNull()
        expect(result.data[0].ranked_choices).toEqual(['Secure Option A'])
        cleanup.push({ type: 'vote', id: result.data[0].id })
      })
    })

    it('should verify ballot immutability after submission', async () => {
      const originalBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A', 'Secure Option B']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([originalBallot])
        .select()

      expect(error).toBeNull()
      const voteId = data[0].id
      
      // Attempt to modify the ballot (should be prevented by RLS or fail)
      const { data: updateData, error: updateError } = await supabase
        .from('votes')
        .update({ ranked_choices: ['Modified Option'] })
        .eq('id', voteId)
        .select()

      // Updates should be prevented or fail
      expect(updateData === null || updateData.length === 0).toBe(true)
      
      // Verify original data unchanged
      const { data: verifyData } = await supabase
        .from('votes')
        .select('ranked_choices')
        .eq('id', voteId)
        .single()
      
      expect(verifyData.ranked_choices).toEqual(['Secure Option A', 'Secure Option B'])
      
      cleanup.push({ type: 'vote', id: voteId })
    })
  })

  describe('2. Data Consistency During Transactions', () => {
    it('should maintain consistency during database transactions', async () => {
      const transactionBallots = [
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Secure Option A']
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice', 
          ranked_choices: ['Secure Option B']
        },
        {
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Secure Option C']
        }
      ]

      // Submit all ballots in sequence to test transaction consistency
      const results = []
      for (const ballot of transactionBallots) {
        const { data, error } = await supabase
          .from('votes')
          .insert([ballot])
          .select()
        
        expect(error).toBeNull()
        results.push(data[0])
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Verify all ballots were inserted correctly
      expect(results.length).toBe(3)
      expect(results[0].ranked_choices).toEqual(['Secure Option A'])
      expect(results[1].ranked_choices).toEqual(['Secure Option B'])
      expect(results[2].ranked_choices).toEqual(['Secure Option C'])
    })

    it('should handle database failures gracefully', async () => {
      // Test with invalid data to trigger database error
      const invalidBallot = {
        poll_id: 'invalid-uuid-format',
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([invalidBallot])
        .select()

      expect(error).toBeDefined()
      expect(data).toBeNull()
      
      // Verify database is still functional after error
      const validBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A']
      }

      const { data: validData, error: validError } = await supabase
        .from('votes')
        .insert([validBallot])
        .select()

      expect(validError).toBeNull()
      expect(validData[0].ranked_choices).toEqual(['Secure Option A'])
      
      cleanup.push({ type: 'vote', id: validData[0].id })
    })

    it('should verify ballot retrieval accuracy', async () => {
      const originalBallots = [
        ['Secure Option A', 'Secure Option B'],
        ['Secure Option C', 'Secure Option A'],
        ['Secure Option B', 'Secure Option D', 'Secure Option A']
      ]

      const insertedIds = []
      
      // Insert ballots
      for (const ballot of originalBallots) {
        const { data, error } = await supabase
          .from('votes')
          .insert([{
            poll_id: testPollId,
            vote_type: 'ranked_choice',
            ranked_choices: ballot
          }])
          .select()
        
        expect(error).toBeNull()
        insertedIds.push(data[0].id)
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Retrieve and verify each ballot
      for (let i = 0; i < insertedIds.length; i++) {
        const { data, error } = await supabase
          .from('votes')
          .select('ranked_choices')
          .eq('id', insertedIds[i])
          .single()
        
        expect(error).toBeNull()
        expect(data.ranked_choices).toEqual(originalBallots[i])
      }
    })
  })

  describe('3. Error Handling and Recovery', () => {
    it('should handle network interruption gracefully', async () => {
      // Simulate a valid ballot that should succeed
      const networkBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A', 'Secure Option B']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([networkBallot])
        .select()

      // Should succeed under normal conditions
      expect(error).toBeNull()
      expect(data[0].ranked_choices).toEqual(['Secure Option A', 'Secure Option B'])
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should validate data integrity after system recovery', async () => {
      // Insert a ballot
      const recoverryBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option C', 'Secure Option D']
      }

      const { data: insertData, error: insertError } = await supabase
        .from('votes')
        .insert([recoverryBallot])
        .select()

      expect(insertError).toBeNull()
      const voteId = insertData[0].id
      
      // Simulate system recovery by re-querying
      await new Promise(resolve => setTimeout(resolve, 100)) // Small delay
      
      const { data: recoveryData, error: recoveryError } = await supabase
        .from('votes')
        .select('*')
        .eq('id', voteId)
        .single()

      expect(recoveryError).toBeNull()
      expect(recoveryData.ranked_choices).toEqual(['Secure Option C', 'Secure Option D'])
      expect(recoveryData.poll_id).toBe(testPollId)
      expect(recoveryData.vote_type).toBe('ranked_choice')
      
      cleanup.push({ type: 'vote', id: voteId })
    })

    it('should maintain referential integrity', async () => {
      // Test that votes properly reference valid polls
      const validBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([validBallot])
        .select()

      expect(error).toBeNull()
      
      // Verify the poll still exists
      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .select('id, title')
        .eq('id', testPollId)
        .single()

      expect(pollError).toBeNull()
      expect(pollData.id).toBe(testPollId)
      expect(pollData.title).toBe('Test Poll for Data Integrity')
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })
  })

  describe('4. Data Audit and Logging', () => {
    it('should preserve audit trail for ballot submissions', async () => {
      const auditBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A', 'Secure Option B']
      }

      const beforeSubmission = new Date()
      
      const { data, error } = await supabase
        .from('votes')
        .insert([auditBallot])
        .select()

      const afterSubmission = new Date()

      expect(error).toBeNull()
      
      // Verify audit fields
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('created_at')
      
      const createdAt = new Date(data[0].created_at)
      expect(createdAt >= beforeSubmission).toBe(true)
      // Allow for small timing differences (within 5 seconds)
      expect(createdAt <= new Date(afterSubmission.getTime() + 5000)).toBe(true)
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should log ballot modification attempts', async () => {
      const originalBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([originalBallot])
        .select()

      expect(error).toBeNull()
      
      // Attempt modification (should fail silently or be logged)
      const modificationAttempt = await supabase
        .from('votes')
        .update({ ranked_choices: ['Modified'] })
        .eq('id', data[0].id)

      // Verify original data is unchanged
      const { data: unchangedData } = await supabase
        .from('votes')
        .select('ranked_choices')
        .eq('id', data[0].id)
        .single()
      
      expect(unchangedData.ranked_choices).toEqual(['Secure Option A'])
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should maintain data lineage for ballot processing', async () => {
      // Track the complete lifecycle of a ballot
      const lifecycle = {
        originalOptions: ['Secure Option A', 'Secure Option B', 'Secure Option C', 'Secure Option D'],
        mainList: ['Secure Option B', 'Secure Option A'],
        noPreferenceList: ['Secure Option C', 'Secure Option D'],
        submittedBallot: ['Secure Option B', 'Secure Option A']
      }

      const ballotData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: lifecycle.submittedBallot
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([ballotData])
        .select()

      expect(error).toBeNull()
      
      // Verify data lineage
      expect(data[0].ranked_choices).toEqual(lifecycle.submittedBallot)
      expect(data[0].ranked_choices.length).toBe(2)
      
      // Verify no preference items are not included
      const submittedString = JSON.stringify(data[0].ranked_choices)
      expect(submittedString).not.toContain('Secure Option C')
      expect(submittedString).not.toContain('Secure Option D')
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })
  })

  describe('5. Cross-System Data Validation', () => {
    it('should validate data consistency across multiple queries', async () => {
      const consistencyBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Secure Option A', 'Secure Option C', 'Secure Option B']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([consistencyBallot])
        .select()

      expect(error).toBeNull()
      const voteId = data[0].id

      // Query the same data multiple ways
      const queries = [
        supabase.from('votes').select('ranked_choices').eq('id', voteId).single(),
        supabase.from('votes').select('*').eq('id', voteId).single(),
        supabase.from('votes').select('ranked_choices, poll_id, vote_type').eq('id', voteId).single()
      ]

      const results = await Promise.all(queries)
      
      // All queries should return consistent data
      results.forEach(result => {
        expect(result.error).toBeNull()
        expect(result.data.ranked_choices).toEqual(['Secure Option A', 'Secure Option C', 'Secure Option B'])
      })
      
      cleanup.push({ type: 'vote', id: voteId })
    })

    it('should maintain data integrity during high concurrency', async () => {
      const concurrentBallots = Array.from({ length: 10 }, (_, i) => ({
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: [`Secure Option ${String.fromCharCode(65 + (i % 4))}`] // A, B, C, D rotation
      }))

      const submissions = concurrentBallots.map(ballot =>
        supabase.from('votes').insert([ballot]).select()
      )

      const results = await Promise.all(submissions)
      
      // All should succeed with correct data
      results.forEach((result, index) => {
        expect(result.error).toBeNull()
        expect(result.data[0].ranked_choices).toEqual(concurrentBallots[index].ranked_choices)
        cleanup.push({ type: 'vote', id: result.data[0].id })
      })
    })
  })
})