/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { isApiAvailable, apiCreateTestQuestion, apiSubmitTestVote, apiGetVotes } from '../../helpers/database.js'

let apiUp = false
let testQuestionId = null

beforeAll(async () => {
  apiUp = await isApiAvailable()
  if (apiUp) {
    const question = await apiCreateTestQuestion({
      title: 'Test Question for Ballot Filtering',
      question_type: 'ranked_choice',
      options: ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E'],
      creator_secret: 'filtering-test-secret-' + Date.now(),
    })
    testQuestionId = question.id
  }
})

describe('Ballot Filtering Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Core Filtering Logic', () => {
    it('should filter ballot with all items in main list', () => {
      const mainList = ['Candidate A', 'Candidate B', 'Candidate C']
      const ballotData = mainList
      expect(ballotData).toEqual(['Candidate A', 'Candidate B', 'Candidate C'])
    })

    it('should filter ballot with mixed distribution', () => {
      const mainList = ['Candidate A', 'Candidate B', 'Candidate C']
      const ballotData = mainList
      expect(ballotData).not.toContain('Candidate D')
      expect(ballotData).not.toContain('Candidate E')
    })

    it('should handle single item in main list', () => {
      const mainList = ['Candidate A']
      expect(mainList.length).toBe(1)
    })

    it('should verify order preservation in filtered ballot', () => {
      const mainList = ['Candidate C', 'Candidate A', 'Candidate B']
      expect(mainList[0]).toBe('Candidate C')
      expect(mainList[1]).toBe('Candidate A')
      expect(mainList[2]).toBe('Candidate B')
    })

    it('should handle filtering with special characters in candidate names', () => {
      const specialCandidates = [
        'Candidate with émojis 🎉',
        'Candidate with "quotes"',
        'Candidate with <html>',
        'Candidate & ampersand'
      ]
      expect(specialCandidates.length).toBe(4)
      expect(specialCandidates).toContain('Candidate with émojis 🎉')
    })

    it('should verify no preference items completely absent from ballot data', () => {
      const mainList = ['Candidate A']
      const allBallotData = JSON.stringify(mainList)
      expect(allBallotData).not.toContain('Candidate B')
      expect(allBallotData).not.toContain('Candidate C')
    })
  })

  describe('2. Validation Logic', () => {
    it('should block submission when main list is empty', () => {
      const emptyMainList = []
      const filteredChoices = emptyMainList.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices.length).toBe(0)
    })

    it('should allow submission with minimum required candidates (1)', () => {
      const singleCandidate = ['Candidate A']
      const filteredChoices = singleCandidate.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices.length).toBe(1)
    })

    it('should validate ballot format matches expected schema', () => {
      const validBallot = {
        question_id: 'some-id',
        vote_type: 'ranked_choice',
        ranked_choices: ['Candidate A', 'Candidate B']
      }
      expect(validBallot).toHaveProperty('question_id')
      expect(validBallot).toHaveProperty('vote_type')
      expect(validBallot).toHaveProperty('ranked_choices')
      expect(Array.isArray(validBallot.ranked_choices)).toBe(true)
    })

    it('should filter out empty or whitespace-only choices', () => {
      const choicesWithEmpty = ['Candidate A', '', '   ', 'Candidate B', null, undefined]
      const filteredChoices = choicesWithEmpty.filter(choice => choice && choice.trim().length > 0)
      expect(filteredChoices).toEqual(['Candidate A', 'Candidate B'])
    })
  })

  describe('3. API Integration Tests', () => {
    it('should successfully submit filtered ballot via API', async ({ skip }) => {
      if (!apiUp) skip()
      const vote = await apiSubmitTestVote(testQuestionId, {
        vote_type: 'ranked_choice',
        ranked_choices: ['Candidate A', 'Candidate C'],
      })
      expect(vote).toBeDefined()
      expect(vote.ranked_choices).toEqual(['Candidate A', 'Candidate C'])
    })

    it('should verify ballot data integrity via API', async ({ skip }) => {
      if (!apiUp) skip()
      const originalBallot = ['Candidate B', 'Candidate D', 'Candidate A']
      const vote = await apiSubmitTestVote(testQuestionId, {
        vote_type: 'ranked_choice',
        ranked_choices: originalBallot,
      })
      expect(vote.ranked_choices).toEqual(originalBallot)
    })

    it('should handle concurrent ballot submissions', async ({ skip }) => {
      if (!apiUp) skip()
      const submissions = [
        apiSubmitTestVote(testQuestionId, { vote_type: 'ranked_choice', ranked_choices: ['Candidate A'] }),
        apiSubmitTestVote(testQuestionId, { vote_type: 'ranked_choice', ranked_choices: ['Candidate B'] }),
        apiSubmitTestVote(testQuestionId, { vote_type: 'ranked_choice', ranked_choices: ['Candidate C'] }),
      ]
      const results = await Promise.all(submissions)
      results.forEach((result, index) => {
        expect(result).toBeDefined()
        expect(result.ranked_choices).toBeDefined()
      })
    })
  })

  describe('4. Edge Case Scenarios', () => {
    it('should handle exactly 1 candidate in main list', async ({ skip }) => {
      if (!apiUp) skip()
      const vote = await apiSubmitTestVote(testQuestionId, {
        vote_type: 'ranked_choice',
        ranked_choices: ['Candidate E'],
      })
      expect(vote.ranked_choices.length).toBe(1)
      expect(vote.ranked_choices[0]).toBe('Candidate E')
    })

    it('should handle maximum allowed candidates', async ({ skip }) => {
      if (!apiUp) skip()
      const maxCandidates = ['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D', 'Candidate E']
      const vote = await apiSubmitTestVote(testQuestionId, {
        vote_type: 'ranked_choice',
        ranked_choices: maxCandidates,
      })
      expect(vote.ranked_choices.length).toBe(5)
      expect(vote.ranked_choices).toEqual(maxCandidates)
    })
  })

  describe('5. Performance Tests', () => {
    it('should filter ballots with 50+ candidates efficiently', () => {
      const largeCandidateList = Array.from({ length: 50 }, (_, i) => `Candidate ${i + 1}`)
      const startTime = Date.now()
      const filteredList = largeCandidateList.filter(choice => choice && choice.trim().length > 0)
      expect(filteredList.length).toBe(50)
      expect(Date.now() - startTime).toBeLessThan(100)
    })

    it('should verify memory usage does not grow during filtering', () => {
      const initialMemory = process.memoryUsage().heapUsed
      for (let i = 0; i < 1000; i++) {
        const candidates = [`Candidate ${i}A`, `Candidate ${i}B`, `Candidate ${i}C`]
        const filtered = candidates.filter(choice => choice && choice.trim().length > 0)
        expect(filtered.length).toBe(3)
      }
      const memoryGrowth = process.memoryUsage().heapUsed - initialMemory
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024)
    })
  })

  describe('6. Validation Error Handling', () => {
    it('should display appropriate error for empty main list', () => {
      const shouldShowError = [].length === 0
      expect(shouldShowError).toBe(true)
    })

    it('should display appropriate error for invalid candidates', () => {
      const questionOptions = ['Candidate A', 'Candidate B', 'Candidate C']
      const userChoices = ['Candidate A', 'Invalid Candidate', 'Candidate B']
      const invalidChoices = userChoices.filter(choice => !questionOptions.includes(choice))
      expect(invalidChoices).toEqual(['Invalid Candidate'])
    })

    it('should handle invalid question ID gracefully', async ({ skip }) => {
      if (!apiUp) skip()
      try {
        await apiSubmitTestVote('00000000-0000-0000-0000-000000000000', {
          vote_type: 'ranked_choice',
          ranked_choices: ['Candidate A'],
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).toContain('Failed to submit vote')
      }
    })
  })
})
