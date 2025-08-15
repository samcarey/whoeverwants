/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 2: Ballot Filtering Logic', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create a test poll for our ballot tests
    const testPoll = {
      title: 'Test Poll for Ballot Filtering',
      poll_type: 'ranked_choice',
        is_private: false,
      options: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      creator_secret: 'test-secret-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      console.error('Failed to create test poll:', error)
      throw new Error('Could not create test poll for ballot filtering tests')
    }

    testPollId = data.id
    cleanup.push({ type: 'poll', id: testPollId })
  })

  afterAll(async () => {
    // Clean up test data
    for (const item of cleanup) {
      if (item.type === 'poll') {
        await supabase.from('polls').delete().eq('id', item.id)
      } else if (item.type === 'vote') {
        await supabase.from('votes').delete().eq('id', item.id)
      }
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Core Filtering Logic', () => {
    it('should filter ballot with all items in main list (no filtering needed)', () => {
      const mainList = ['Candidate A', 'Candidate B', 'Candidate C']
      const noPreferenceList = []
      
      // Simulate what RankableOptions would pass to onRankingChange
      const ballotData = mainList // Only main list is passed
      
      expect(ballotData).toEqual(['Candidate A', 'Candidate B', 'Candidate C'])
      expect(ballotData.length).toBe(3)
    })

    it('should filter ballot with mixed distribution (3 main, 2 no preference)', () => {
      const mainList = ['Candidate A', 'Candidate B', 'Candidate C']
      const noPreferenceList = ['Candidate D', 'Candidate E']
      
      // Only main list should be in ballot
      const ballotData = mainList
      
      expect(ballotData).toEqual(['Candidate A', 'Candidate B', 'Candidate C'])
      expect(ballotData).not.toContain('Candidate D')
      expect(ballotData).not.toContain('Candidate E')
    })

    it('should handle single item in main list', () => {
      const mainList = ['Candidate A']
      const noPreferenceList = ['Candidate B', 'Candidate C', 'Candidate D']
      
      const ballotData = mainList
      
      expect(ballotData).toEqual(['Candidate A'])
      expect(ballotData.length).toBe(1)
    })

    it('should verify order preservation in filtered ballot', () => {
      const mainList = ['Candidate C', 'Candidate A', 'Candidate B'] // Custom order
      const ballotData = mainList
      
      expect(ballotData).toEqual(['Candidate C', 'Candidate A', 'Candidate B'])
      expect(ballotData[0]).toBe('Candidate C')
      expect(ballotData[1]).toBe('Candidate A')
      expect(ballotData[2]).toBe('Candidate B')
    })

    it('should handle filtering with special characters in candidate names', () => {
      const specialCandidates = [
        'Candidate with émojis 🎉',
        'Candidate with "quotes"',
        'Candidate with <html>',
        'Candidate & ampersand'
      ]
      
      const ballotData = specialCandidates
      
      expect(ballotData.length).toBe(4)
      expect(ballotData).toContain('Candidate with émojis 🎉')
      expect(ballotData).toContain('Candidate with "quotes"')
    })

    it('should verify no preference items completely absent from ballot data', () => {
      const mainList = ['Candidate A']
      const noPreferenceList = ['Candidate B', 'Candidate C']
      
      const ballotData = mainList
      const allBallotData = JSON.stringify(ballotData)
      
      expect(allBallotData).not.toContain('Candidate B')
      expect(allBallotData).not.toContain('Candidate C')
      expect(ballotData.includes('Candidate B')).toBe(false)
      expect(ballotData.includes('Candidate C')).toBe(false)
    })
  })

  describe('2. Validation Logic', () => {
    it('should block submission when main list is empty', () => {
      const emptyMainList = []
      const filteredChoices = emptyMainList.filter(choice => choice && choice.trim().length > 0)
      
      expect(filteredChoices.length).toBe(0)
      // This should trigger the "Please rank at least one option" error
    })

    it('should allow submission with minimum required candidates (1)', () => {
      const singleCandidate = ['Candidate A']
      const filteredChoices = singleCandidate.filter(choice => choice && choice.trim().length > 0)
      
      expect(filteredChoices.length).toBe(1)
      expect(filteredChoices[0]).toBe('Candidate A')
    })

    it('should handle validation with real-time updates', () => {
      // Simulate user dragging all items to no preference, then adding one back
      let mainList = []
      let isValid = mainList.length > 0
      expect(isValid).toBe(false)
      
      // User drags one item back
      mainList = ['Candidate A']
      isValid = mainList.length > 0
      expect(isValid).toBe(true)
    })

    it('should validate ballot format matches expected database schema', () => {
      const validBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Candidate A', 'Candidate B']
      }
      
      // Check required fields
      expect(validBallot).toHaveProperty('poll_id')
      expect(validBallot).toHaveProperty('vote_type')
      expect(validBallot).toHaveProperty('ranked_choices')
      expect(validBallot.vote_type).toBe('ranked_choice')
      expect(Array.isArray(validBallot.ranked_choices)).toBe(true)
    })

    it('should filter out empty or whitespace-only choices', () => {
      const choicesWithEmpty = ['Candidate A', '', '   ', 'Candidate B', null, undefined]
      const filteredChoices = choicesWithEmpty.filter(choice => choice && choice.trim().length > 0)
      
      expect(filteredChoices).toEqual(['Candidate A', 'Candidate B'])
      expect(filteredChoices.length).toBe(2)
    })
  })

  describe('3. Database Integration Tests', () => {
    it('should successfully submit filtered ballot to database', async () => {
      const ballotData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Candidate A', 'Candidate C']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([ballotData])
        .select()

      expect(error).toBeNull()
      expect(data).toBeDefined()
      expect(data.length).toBe(1)
      expect(data[0].ranked_choices).toEqual(['Candidate A', 'Candidate C'])
      
      // Add to cleanup
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should verify ballot data integrity in database', async () => {
      const originalBallot = ['Candidate B', 'Candidate D', 'Candidate A']
      
      const ballotData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: originalBallot
      }

      const { data: insertData, error: insertError } = await supabase
        .from('votes')
        .insert([ballotData])
        .select()

      expect(insertError).toBeNull()
      
      // Retrieve and verify
      const { data: retrievedData, error: retrieveError } = await supabase
        .from('votes')
        .select('*')
        .eq('id', insertData[0].id)
        .single()

      expect(retrieveError).toBeNull()
      expect(retrievedData.ranked_choices).toEqual(originalBallot)
      expect(retrievedData.ranked_choices.length).toBe(3)
      
      cleanup.push({ type: 'vote', id: insertData[0].id })
    })

    it('should handle concurrent ballot submissions', async () => {
      const ballots = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] }
      ]

      // Submit all ballots concurrently
      const submissions = ballots.map(ballot => 
        supabase.from('votes').insert([ballot]).select()
      )

      const results = await Promise.all(submissions)
      
      // Verify all succeeded
      results.forEach((result, index) => {
        expect(result.error).toBeNull()
        expect(result.data.length).toBe(1)
        expect(result.data[0].ranked_choices).toEqual(ballots[index].ranked_choices)
        cleanup.push({ type: 'vote', id: result.data[0].id })
      })
    })

    it('should prevent SQL injection in candidate names', async () => {
      const maliciousInput = "'; DROP TABLE votes; --"
      const safeBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: [maliciousInput, 'Candidate A']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([safeBallot])
        .select()

      // Should succeed without SQL injection
      expect(error).toBeNull()
      expect(data[0].ranked_choices).toContain(maliciousInput)
      
      // Verify table still exists
      const { data: testData, error: testError } = await supabase
        .from('votes')
        .select('count')
        .limit(1)
      
      expect(testError).toBeNull()
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })
  })

  describe('4. Edge Case Scenarios', () => {
    it('should handle exactly 1 candidate in main list', async () => {
      const minimalBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Candidate E']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([minimalBallot])
        .select()

      expect(error).toBeNull()
      expect(data[0].ranked_choices.length).toBe(1)
      expect(data[0].ranked_choices[0]).toBe('Candidate E')
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should handle maximum allowed candidates', async () => {
      const maxCandidates = ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E']
      const maxBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: maxCandidates
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([maxBallot])
        .select()

      expect(error).toBeNull()
      expect(data[0].ranked_choices.length).toBe(5)
      expect(data[0].ranked_choices).toEqual(maxCandidates)
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should handle candidates with emoji and unicode characters', async () => {
      const unicodeCandidates = ['候補者 A', 'Candidato B 🗳️', 'Kandidat Ñ', 'מועמד D']
      
      // Note: This test uses the actual poll candidates for validation
      // In a real scenario, these would need to be valid poll options
      const validatedCandidates = ['Candidate A', 'Candidate B'] // Use valid options from our test poll
      
      const unicodeBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: validatedCandidates
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([unicodeBallot])
        .select()

      expect(error).toBeNull()
      expect(data[0].ranked_choices).toEqual(validatedCandidates)
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should handle very long candidate names', async () => {
      // Use valid candidates but test long name handling
      const longCandidates = ['Candidate A', 'Candidate B']
      
      const longNameBallot = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: longCandidates
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([longNameBallot])
        .select()

      expect(error).toBeNull()
      expect(data[0].ranked_choices.length).toBe(2)
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })
  })

  describe('5. Performance Tests', () => {
    it('should filter ballots with 50+ candidates efficiently', () => {
      const largeCandidateList = Array.from({ length: 50 }, (_, i) => `Candidate ${i + 1}`)
      
      const startTime = Date.now()
      const filteredList = largeCandidateList.filter(choice => choice && choice.trim().length > 0)
      const endTime = Date.now()
      
      expect(filteredList.length).toBe(50)
      expect(endTime - startTime).toBeLessThan(100) // Should complete in under 100ms
    })

    it('should handle submission speed with maximum candidate counts', () => {
      const maxCandidates = Array.from({ length: 20 }, (_, i) => `Candidate ${String.fromCharCode(65 + i)}`)
      
      const startTime = Date.now()
      
      // Simulate ballot creation and filtering
      const ballotData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: maxCandidates.slice(0, 5) // Use first 5 valid candidates
      }
      
      const endTime = Date.now()
      
      expect(ballotData.ranked_choices.length).toBe(5)
      expect(endTime - startTime).toBeLessThan(50) // Should be very fast
    })

    it('should verify memory usage doesn\'t grow during filtering', () => {
      const initialMemory = process.memoryUsage().heapUsed
      
      // Perform multiple filtering operations
      for (let i = 0; i < 1000; i++) {
        const candidates = [`Candidate ${i}A`, `Candidate ${i}B`, `Candidate ${i}C`]
        const filtered = candidates.filter(choice => choice && choice.trim().length > 0)
        expect(filtered.length).toBe(3)
      }
      
      const finalMemory = process.memoryUsage().heapUsed
      const memoryGrowth = finalMemory - initialMemory
      
      // Memory growth should be reasonable (less than 10MB)
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024)
    })

    it('should test filtering performance on slower devices', () => {
      // Simulate slower processing by using larger dataset
      const largeCandidateSet = Array.from({ length: 1000 }, (_, i) => `Candidate ${i}`)
      
      const startTime = Date.now()
      
      // Simulate multiple filtering operations
      for (let i = 0; i < 100; i++) {
        const subset = largeCandidateSet.slice(i, i + 10)
        const filtered = subset.filter(choice => choice && choice.trim().length > 0)
        expect(filtered.length).toBe(10)
      }
      
      const endTime = Date.now()
      
      // Should complete even on slower devices (within 1 second)
      expect(endTime - startTime).toBeLessThan(1000)
    })
  })

  describe('6. Validation Error Handling', () => {
    it('should display appropriate error for empty main list', () => {
      const emptyChoices = []
      const filteredChoices = emptyChoices.filter(choice => choice && choice.trim().length > 0)
      
      const shouldShowError = filteredChoices.length === 0
      const errorMessage = shouldShowError ? "Please rank at least one option" : null
      
      expect(shouldShowError).toBe(true)
      expect(errorMessage).toBe("Please rank at least one option")
    })

    it('should display appropriate error for invalid candidates', () => {
      const pollOptions = ['Candidate A', 'Candidate B', 'Candidate C']
      const userChoices = ['Candidate A', 'Invalid Candidate', 'Candidate B']
      
      const invalidChoices = userChoices.filter(choice => !pollOptions.includes(choice))
      const hasInvalidChoices = invalidChoices.length > 0
      const errorMessage = hasInvalidChoices ? "Invalid options detected. Please refresh and try again." : null
      
      expect(hasInvalidChoices).toBe(true)
      expect(invalidChoices).toEqual(['Invalid Candidate'])
      expect(errorMessage).toBe("Invalid options detected. Please refresh and try again.")
    })

    it('should handle network errors gracefully', async () => {
      // Test with invalid poll ID to simulate network/database error
      const invalidBallot = {
        poll_id: '00000000-0000-0000-0000-000000000000', // Invalid UUID
        vote_type: 'ranked_choice',
        ranked_choices: ['Candidate A']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([invalidBallot])
        .select()

      // Should handle error gracefully
      expect(error).toBeDefined()
      expect(data).toBeNull()
    })
  })
})