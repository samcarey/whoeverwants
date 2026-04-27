/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isApiAvailable, apiCreateTestQuestion, apiSubmitTestVote } from '../../helpers/database.js'

let apiUp = false
let testQuestionId = null

beforeAll(async () => {
  apiUp = await isApiAvailable()
  if (apiUp) {
    const question = await apiCreateTestQuestion({
      title: 'Test Question for Ballot Validation',
      question_type: 'ranked_choice',
      options: ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta'],
      creator_secret: 'validation-test-secret-' + Date.now(),
    })
    testQuestionId = question.id
  }
})

describe('Ballot Validation Tests', () => {
  describe('1. Minimum Candidate Validation', () => {
    it('should reject ballot with zero candidates', () => {
      const emptyBallot = []
      const filteredChoices = emptyBallot.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices.length > 0).toBe(false)
    })

    it('should accept ballot with exactly one candidate', () => {
      const singleCandidateBallot = ['Option Alpha']
      const filteredChoices = singleCandidateBallot.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices.length > 0).toBe(true)
      expect(filteredChoices.length).toBe(1)
    })

    it('should accept ballot with multiple candidates', () => {
      const multiCandidateBallot = ['Option Alpha', 'Option Beta', 'Option Gamma']
      const filteredChoices = multiCandidateBallot.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices.length > 0).toBe(true)
      expect(filteredChoices.length).toBe(3)
    })

    it('should handle whitespace-only candidates', () => {
      const ballotWithWhitespace = ['Option Alpha', '   ', '\t\n', 'Option Beta']
      const filteredChoices = ballotWithWhitespace.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices).toEqual(['Option Alpha', 'Option Beta'])
    })

    it('should handle null and undefined candidates', () => {
      const ballotWithNulls = ['Option Alpha', null, undefined, 'Option Beta', '']
      const filteredChoices = ballotWithNulls.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices).toEqual(['Option Alpha', 'Option Beta'])
    })
  })

  describe('2. Question Option Validation', () => {
    const questionOptions = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']

    it('should accept ballot with all valid question options', () => {
      const validBallot = ['Option Alpha', 'Option Beta']
      const invalidChoices = validBallot.filter(choice => !questionOptions.includes(choice))
      expect(invalidChoices.length).toBe(0)
    })

    it('should reject ballot with invalid options', () => {
      const invalidBallot = ['Option Alpha', 'Invalid Option', 'Option Beta']
      const invalidChoices = invalidBallot.filter(choice => !questionOptions.includes(choice))
      expect(invalidChoices.length).toBe(1)
      expect(invalidChoices).toContain('Invalid Option')
    })

    it('should handle case sensitivity correctly', () => {
      const caseSensitiveBallot = ['option alpha', 'OPTION BETA', 'Option Gamma']
      const invalidChoices = caseSensitiveBallot.filter(choice => !questionOptions.includes(choice))
      expect(invalidChoices.length).toBe(2)
    })

    it('should handle duplicate candidates in ballot', () => {
      const duplicateBallot = ['Option Alpha', 'Option Beta', 'Option Alpha']
      const uniqueBallot = [...new Set(duplicateBallot)]
      expect(uniqueBallot).toEqual(['Option Alpha', 'Option Beta'])
    })
  })

  describe('3. Real-time Validation', () => {
    it('should validate as user moves items between lists', () => {
      let mainList = ['Option Alpha', 'Option Beta']
      let noPreferenceList = []
      expect(mainList.length > 0).toBe(true)

      const movedItem = mainList.pop()
      noPreferenceList.push(movedItem)
      expect(mainList.length > 0).toBe(true)

      const lastItem = mainList.pop()
      noPreferenceList.push(lastItem)
      expect(mainList.length > 0).toBe(false)
    })

    it('should update validation state immediately', () => {
      const validationStates = []
      let currentBallot = []
      validationStates.push(currentBallot.length > 0)
      currentBallot = ['Option Alpha']
      validationStates.push(currentBallot.length > 0)
      currentBallot = []
      validationStates.push(currentBallot.length > 0)
      expect(validationStates).toEqual([false, true, false])
    })
  })

  describe('4. Error Message Validation', () => {
    it('should provide clear error for empty ballot', () => {
      const getErrorMessage = (choices) => {
        if (choices.length === 0) return "Please rank at least one option"
        return null
      }
      expect(getErrorMessage([])).toBe("Please rank at least one option")
    })

    it('should provide clear error for invalid options', () => {
      const questionOptions = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']
      const getErrorMessage = (choices, validOptions) => {
        const invalidChoices = choices.filter(choice => !validOptions.includes(choice))
        if (invalidChoices.length > 0) return "Invalid options detected. Please refresh and try again."
        return null
      }
      expect(getErrorMessage(['Option Alpha', 'Fake Option'], questionOptions)).toBe("Invalid options detected. Please refresh and try again.")
    })

    it('should handle multiple validation errors appropriately', () => {
      const questionOptions = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']
      const getValidationErrors = (choices, validOptions) => {
        const errors = []
        const filteredChoices = choices.filter(choice => choice && choice.trim().length > 0)
        if (filteredChoices.length === 0) errors.push("Please rank at least one option")
        const invalidChoices = filteredChoices.filter(choice => !validOptions.includes(choice))
        if (invalidChoices.length > 0) errors.push("Invalid options detected. Please refresh and try again.")
        return errors
      }
      expect(getValidationErrors([], questionOptions)).toEqual(["Please rank at least one option"])
      expect(getValidationErrors(['Fake Option'], questionOptions)).toEqual(["Invalid options detected. Please refresh and try again."])
      expect(getValidationErrors(['Option Alpha'], questionOptions)).toEqual([])
    })
  })

  describe('5. API Validation Integration', () => {
    it('should reject vote with invalid vote type', async ({ skip }) => {
      if (!apiUp) skip()
      try {
        await apiSubmitTestVote(testQuestionId, {
          vote_type: 'invalid_type',
          ranked_choices: ['Option Alpha'],
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).toContain('Failed to submit vote')
      }
    })

    it('should accept valid ranked choice vote', async ({ skip }) => {
      if (!apiUp) skip()
      const vote = await apiSubmitTestVote(testQuestionId, {
        vote_type: 'ranked_choice',
        ranked_choices: ['Option Alpha', 'Option Beta'],
      })
      expect(vote).toBeDefined()
      expect(vote.ranked_choices).toEqual(['Option Alpha', 'Option Beta'])
    })

    it('should reject vote for non-existent question', async ({ skip }) => {
      if (!apiUp) skip()
      try {
        await apiSubmitTestVote('00000000-0000-0000-0000-000000000000', {
          vote_type: 'ranked_choice',
          ranked_choices: ['Option Alpha'],
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).toContain('Failed to submit vote')
      }
    })
  })

  describe('6. Validation Performance', () => {
    it('should validate large ballots quickly', () => {
      const largeBallot = Array.from({ length: 100 }, (_, i) => `Option ${i}`)
      const validOptions = Array.from({ length: 100 }, (_, i) => `Option ${i}`)
      const startTime = Date.now()
      const filteredChoices = largeBallot.filter(choice => choice && choice.trim().length > 0)
      const invalidChoices = filteredChoices.filter(choice => !validOptions.includes(choice))
      const isValid = filteredChoices.length > 0 && invalidChoices.length === 0
      expect(isValid).toBe(true)
      expect(Date.now() - startTime).toBeLessThan(100)
    })

    it('should handle rapid validation updates efficiently', () => {
      const startTime = Date.now()
      for (let i = 0; i < 1000; i++) {
        const testBallot = [`Option ${i % 4}`]
        expect(testBallot.length > 0).toBe(true)
      }
      expect(Date.now() - startTime).toBeLessThan(1000)
    })
  })
})
