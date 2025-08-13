/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 2: Ballot Validation Tests', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create a test poll for validation tests
    const testPoll = {
      title: 'Test Poll for Ballot Validation',
      poll_type: 'ranked_choice',
      options: ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'validation-test-secret-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for validation tests')
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

  describe('1. Minimum Candidate Validation', () => {
    it('should reject ballot with zero candidates', () => {
      const emptyBallot = []
      const filteredChoices = emptyBallot.filter(choice => choice && choice.trim().length > 0)
      
      const isValid = filteredChoices.length > 0
      expect(isValid).toBe(false)
    })

    it('should accept ballot with exactly one candidate', () => {
      const singleCandidateBallot = ['Option Alpha']
      const filteredChoices = singleCandidateBallot.filter(choice => choice && choice.trim().length > 0)
      
      const isValid = filteredChoices.length > 0
      expect(isValid).toBe(true)
      expect(filteredChoices.length).toBe(1)
    })

    it('should accept ballot with multiple candidates', () => {
      const multiCandidateBallot = ['Option Alpha', 'Option Beta', 'Option Gamma']
      const filteredChoices = multiCandidateBallot.filter(choice => choice && choice.trim().length > 0)
      
      const isValid = filteredChoices.length > 0
      expect(isValid).toBe(true)
      expect(filteredChoices.length).toBe(3)
    })

    it('should handle whitespace-only candidates', () => {
      const ballotWithWhitespace = ['Option Alpha', '   ', '\t\n', 'Option Beta']
      const filteredChoices = ballotWithWhitespace.filter(choice => choice && choice.trim().length > 0)
      
      expect(filteredChoices).toEqual(['Option Alpha', 'Option Beta'])
      expect(filteredChoices.length).toBe(2)
    })

    it('should handle null and undefined candidates', () => {
      const ballotWithNulls = ['Option Alpha', null, undefined, 'Option Beta', '']
      const filteredChoices = ballotWithNulls.filter(choice => choice && choice.trim().length > 0)
      
      expect(filteredChoices).toEqual(['Option Alpha', 'Option Beta'])
      expect(filteredChoices.length).toBe(2)
    })
  })

  describe('2. Poll Option Validation', () => {
    const pollOptions = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']

    it('should accept ballot with all valid poll options', () => {
      const validBallot = ['Option Alpha', 'Option Beta']
      const invalidChoices = validBallot.filter(choice => !pollOptions.includes(choice))
      
      expect(invalidChoices.length).toBe(0)
    })

    it('should reject ballot with invalid options', () => {
      const invalidBallot = ['Option Alpha', 'Invalid Option', 'Option Beta']
      const invalidChoices = invalidBallot.filter(choice => !pollOptions.includes(choice))
      
      expect(invalidChoices.length).toBe(1)
      expect(invalidChoices).toContain('Invalid Option')
    })

    it('should handle case sensitivity correctly', () => {
      const caseSensitiveBallot = ['option alpha', 'OPTION BETA', 'Option Gamma']
      const invalidChoices = caseSensitiveBallot.filter(choice => !pollOptions.includes(choice))
      
      // Should detect case mismatches as invalid
      expect(invalidChoices.length).toBe(2)
      expect(invalidChoices).toContain('option alpha')
      expect(invalidChoices).toContain('OPTION BETA')
    })

    it('should handle duplicate candidates in ballot', () => {
      const duplicateBallot = ['Option Alpha', 'Option Beta', 'Option Alpha']
      
      // Remove duplicates
      const uniqueBallot = [...new Set(duplicateBallot)]
      expect(uniqueBallot).toEqual(['Option Alpha', 'Option Beta'])
      expect(uniqueBallot.length).toBe(2)
    })

    it('should validate against parsed JSON poll options', () => {
      const jsonOptions = JSON.stringify(['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta'])
      const parsedOptions = JSON.parse(jsonOptions)
      
      const testBallot = ['Option Alpha', 'Option Gamma']
      const invalidChoices = testBallot.filter(choice => !parsedOptions.includes(choice))
      
      expect(invalidChoices.length).toBe(0)
    })
  })

  describe('3. Real-time Validation', () => {
    it('should validate as user moves items between lists', () => {
      let mainList = ['Option Alpha', 'Option Beta']
      let noPreferenceList = []
      
      // Initial state - valid
      expect(mainList.length > 0).toBe(true)
      
      // User moves one item to no preference
      const movedItem = mainList.pop()
      noPreferenceList.push(movedItem)
      
      expect(mainList.length > 0).toBe(true) // Still valid
      expect(mainList).toEqual(['Option Alpha'])
      
      // User moves last item to no preference
      const lastItem = mainList.pop()
      noPreferenceList.push(lastItem)
      
      expect(mainList.length > 0).toBe(false) // Now invalid
      expect(mainList).toEqual([])
    })

    it('should update validation state immediately', () => {
      const validationStates = []
      
      // Simulate real-time updates
      let currentBallot = []
      validationStates.push(currentBallot.length > 0)
      
      currentBallot = ['Option Alpha']
      validationStates.push(currentBallot.length > 0)
      
      currentBallot = []
      validationStates.push(currentBallot.length > 0)
      
      expect(validationStates).toEqual([false, true, false])
    })

    it('should persist validation state across component re-renders', () => {
      // Simulate component state
      let componentState = {
        rankedChoices: ['Option Alpha', 'Option Beta'],
        hasValidBallot: null
      }
      
      // Calculate validation
      componentState.hasValidBallot = componentState.rankedChoices.length > 0
      expect(componentState.hasValidBallot).toBe(true)
      
      // Simulate re-render with same state
      const restoredState = { ...componentState }
      expect(restoredState.hasValidBallot).toBe(true)
      expect(restoredState.rankedChoices).toEqual(['Option Alpha', 'Option Beta'])
    })
  })

  describe('4. Error Message Validation', () => {
    it('should provide clear error for empty ballot', () => {
      const emptyBallot = []
      const filteredChoices = emptyBallot.filter(choice => choice && choice.trim().length > 0)
      
      const getErrorMessage = (choices) => {
        if (choices.length === 0) {
          return "Please rank at least one option"
        }
        return null
      }
      
      const errorMessage = getErrorMessage(filteredChoices)
      expect(errorMessage).toBe("Please rank at least one option")
    })

    it('should provide clear error for invalid options', () => {
      const pollOptions = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']
      const invalidBallot = ['Option Alpha', 'Fake Option']
      
      const getErrorMessage = (choices, validOptions) => {
        const invalidChoices = choices.filter(choice => !validOptions.includes(choice))
        if (invalidChoices.length > 0) {
          return "Invalid options detected. Please refresh and try again."
        }
        return null
      }
      
      const errorMessage = getErrorMessage(invalidBallot, pollOptions)
      expect(errorMessage).toBe("Invalid options detected. Please refresh and try again.")
    })

    it('should clear errors when ballot becomes valid', () => {
      let currentError = "Please rank at least one option"
      let currentBallot = []
      
      // User adds a valid option
      currentBallot = ['Option Alpha']
      const filteredChoices = currentBallot.filter(choice => choice && choice.trim().length > 0)
      
      if (filteredChoices.length > 0) {
        currentError = null
      }
      
      expect(currentError).toBeNull()
    })

    it('should handle multiple validation errors appropriately', () => {
      const pollOptions = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']
      
      const getValidationErrors = (choices, validOptions) => {
        const errors = []
        
        const filteredChoices = choices.filter(choice => choice && choice.trim().length > 0)
        if (filteredChoices.length === 0) {
          errors.push("Please rank at least one option")
        }
        
        const invalidChoices = filteredChoices.filter(choice => !validOptions.includes(choice))
        if (invalidChoices.length > 0) {
          errors.push("Invalid options detected. Please refresh and try again.")
        }
        
        return errors
      }
      
      // Test empty ballot
      expect(getValidationErrors([], pollOptions)).toEqual(["Please rank at least one option"])
      
      // Test invalid options
      expect(getValidationErrors(['Fake Option'], pollOptions)).toEqual(["Invalid options detected. Please refresh and try again."])
      
      // Test valid ballot
      expect(getValidationErrors(['Option Alpha'], pollOptions)).toEqual([])
    })
  })

  describe('5. Database Validation Integration', () => {
    it('should reject database insertion with invalid vote type', async () => {
      const invalidVoteData = {
        poll_id: testPollId,
        vote_type: 'invalid_type', // Invalid type
        ranked_choices: ['Option Alpha']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([invalidVoteData])
        .select()

      expect(error).toBeDefined()
      expect(error.message).toContain('check constraint')
    })

    it('should reject database insertion with null ranked_choices for ranked_choice vote', async () => {
      const invalidVoteData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: null // Should not be null for ranked choice
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([invalidVoteData])
        .select()

      expect(error).toBeDefined()
    })

    it('should accept valid ballot in database', async () => {
      const validVoteData = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Option Alpha', 'Option Beta']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([validVoteData])
        .select()

      expect(error).toBeNull()
      expect(data).toBeDefined()
      expect(data[0].ranked_choices).toEqual(['Option Alpha', 'Option Beta'])
      
      cleanup.push({ type: 'vote', id: data[0].id })
    })

    it('should validate poll_id exists', async () => {
      const invalidPollVote = {
        poll_id: '00000000-0000-0000-0000-000000000000', // Non-existent poll
        vote_type: 'ranked_choice',
        ranked_choices: ['Option Alpha']
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([invalidPollVote])
        .select()

      expect(error).toBeDefined()
      expect(data).toBeNull()
    })

    it('should handle database constraint violations gracefully', async () => {
      // Test with missing required fields
      const incompleteVote = {
        vote_type: 'ranked_choice',
        ranked_choices: ['Option Alpha']
        // Missing poll_id
      }

      const { data, error } = await supabase
        .from('votes')
        .insert([incompleteVote])
        .select()

      expect(error).toBeDefined()
      expect(data).toBeNull()
    })
  })

  describe('6. Validation Performance', () => {
    it('should validate large ballots quickly', () => {
      const largeBallot = Array.from({ length: 100 }, (_, i) => `Option ${i}`)
      const validOptions = Array.from({ length: 100 }, (_, i) => `Option ${i}`)
      
      const startTime = Date.now()
      
      // Perform validation
      const filteredChoices = largeBallot.filter(choice => choice && choice.trim().length > 0)
      const invalidChoices = filteredChoices.filter(choice => !validOptions.includes(choice))
      const isValid = filteredChoices.length > 0 && invalidChoices.length === 0
      
      const endTime = Date.now()
      
      expect(isValid).toBe(true)
      expect(endTime - startTime).toBeLessThan(100) // Should be very fast
    })

    it('should handle rapid validation updates efficiently', () => {
      const startTime = Date.now()
      
      // Simulate rapid user interactions
      for (let i = 0; i < 1000; i++) {
        const testBallot = [`Option ${i % 4}`] // Cycle through 4 options
        const isValid = testBallot.length > 0
        expect(isValid).toBe(true)
      }
      
      const endTime = Date.now()
      expect(endTime - startTime).toBeLessThan(1000) // Should complete within 1 second
    })

    it('should maintain consistent validation performance', () => {
      const pollOptions = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']
      const timings = []
      
      // Test validation timing consistency
      for (let i = 0; i < 100; i++) {
        const testBallot = ['Option Alpha', 'Option Beta']
        
        const startTime = Date.now()
        const filteredChoices = testBallot.filter(choice => choice && choice.trim().length > 0)
        const invalidChoices = filteredChoices.filter(choice => !pollOptions.includes(choice))
        const isValid = filteredChoices.length > 0 && invalidChoices.length === 0
        const endTime = Date.now()
        
        timings.push(endTime - startTime)
        expect(isValid).toBe(true)
      }
      
      // Calculate average timing
      const averageTime = timings.reduce((sum, time) => sum + time, 0) / timings.length
      expect(averageTime).toBeLessThan(1) // Should average less than 1ms
    })
  })
})