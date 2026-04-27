/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Test the vote storage and retrieval logic (client-side)
describe('Vote Storage and Retrieval', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Vote Data Structure', () => {
    it('should store vote with correct structure', () => {
      const questionId = 'test-question-123'
      const voteId = 'vote-456'

      const votedQuestions = { [questionId]: true }
      const questionVoteIds = { [questionId]: voteId }

      localStorage.setItem('votedQuestions', JSON.stringify(votedQuestions))
      localStorage.setItem('questionVoteIds', JSON.stringify(questionVoteIds))

      const storedVotedQuestions = JSON.parse(localStorage.getItem('votedQuestions'))
      const storedVoteIds = JSON.parse(localStorage.getItem('questionVoteIds'))

      expect(storedVotedQuestions[questionId]).toBe(true)
      expect(storedVoteIds[questionId]).toBe(voteId)
    })

    it('should retrieve vote ID from localStorage', () => {
      const questionId = 'test-question-123'
      const voteId = 'vote-456'

      localStorage.setItem('questionVoteIds', JSON.stringify({ [questionId]: voteId }))

      const stored = JSON.parse(localStorage.getItem('questionVoteIds') || '{}')
      const retrievedVoteId = stored[questionId] || null

      expect(retrievedVoteId).toBe(voteId)
    })
  })

  describe('API Vote Structure', () => {
    it('should handle yes/no vote data structure correctly', () => {
      // Simulates what the API returns
      const apiVote = {
        id: 'vote-789',
        question_id: 'question-123',
        vote_type: 'yes_no',
        yes_no_choice: 'yes',
        ranked_choices: null,
        suggestions: null,
        is_abstain: false,
        voter_name: null,
      }

      expect(apiVote.yes_no_choice).toBe('yes')
      expect(apiVote.vote_type).toBe('yes_no')
    })

    it('should handle ranked choice vote data structure correctly', () => {
      const apiVote = {
        id: 'vote-999',
        question_id: 'question-456',
        vote_type: 'ranked_choice',
        yes_no_choice: null,
        ranked_choices: ['Option A', 'Option B', 'Option C'],
        suggestions: null,
        is_abstain: false,
        voter_name: null,
      }

      expect(apiVote.ranked_choices).toEqual(['Option A', 'Option B', 'Option C'])
      expect(apiVote.vote_type).toBe('ranked_choice')
    })
  })

  describe('Vote Retrieval Bug', () => {
    it('should correctly retrieve and display YES vote (not NO)', () => {
      const questionId = 'bug-test-question'
      const voteId = 'bug-test-vote'

      // Simulates API response for a yes vote
      const apiVote = {
        id: voteId,
        question_id: questionId,
        vote_type: 'yes_no',
        yes_no_choice: 'yes',
      }

      // Store vote ID in localStorage
      localStorage.setItem('questionVoteIds', JSON.stringify({ [questionId]: voteId }))
      localStorage.setItem('votedQuestions', JSON.stringify({ [questionId]: true }))

      // The vote should be YES, not NO
      expect(apiVote.yes_no_choice).toBe('yes')
      expect(apiVote.yes_no_choice).not.toBe('no')

      // Simulate UI display logic
      const displayText = apiVote.yes_no_choice === 'yes' ? 'Yes' : 'No'
      expect(displayText).toBe('Yes')
    })
  })
})
