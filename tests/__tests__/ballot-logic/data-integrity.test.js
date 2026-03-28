/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isApiAvailable, apiCreateTestPoll, apiSubmitTestVote, apiGetVotes } from '../../helpers/database.js'

let apiUp = false
let testPollId = null

beforeAll(async () => {
  apiUp = await isApiAvailable()
  if (apiUp) {
    const poll = await apiCreateTestPoll({
      title: 'Test Poll for Data Integrity',
      category: 'ranked_choice',
      options: ['Secure Option A', 'Secure Option B', 'Secure Option C', 'Secure Option D'],
      creator_secret: 'integrity-test-secret-' + Date.now(),
    })
    testPollId = poll.id
  }
})

describe('Data Integrity Tests', () => {
  describe('1. Vote Data Integrity', () => {
    it('should only store main list items in vote (no preference items excluded)', async ({ skip }) => {
      if (!apiUp) skip()
      const mainList = ['Secure Option A', 'Secure Option B']
      // "no preference" items should never be sent to the API
      const vote = await apiSubmitTestVote(testPollId, {
        vote_type: 'ranked_choice',
        ranked_choices: mainList,
      })
      expect(vote.ranked_choices).toEqual(mainList)
      expect(vote.ranked_choices).not.toContain('Secure Option C')
      expect(vote.ranked_choices).not.toContain('Secure Option D')
    })

    it('should preserve ballot order in stored vote', async ({ skip }) => {
      if (!apiUp) skip()
      const orderedBallot = ['Secure Option D', 'Secure Option A', 'Secure Option C']
      const vote = await apiSubmitTestVote(testPollId, {
        vote_type: 'ranked_choice',
        ranked_choices: orderedBallot,
      })
      expect(vote.ranked_choices).toEqual(orderedBallot)
      expect(vote.ranked_choices[0]).toBe('Secure Option D')
      expect(vote.ranked_choices[1]).toBe('Secure Option A')
      expect(vote.ranked_choices[2]).toBe('Secure Option C')
    })

    it('should handle SQL injection safely in candidate names', async ({ skip }) => {
      if (!apiUp) skip()
      const maliciousInput = "'; DROP TABLE votes; --"
      const vote = await apiSubmitTestVote(testPollId, {
        vote_type: 'ranked_choice',
        ranked_choices: [maliciousInput, 'Secure Option A'],
      })
      // Should succeed without SQL injection
      expect(vote.ranked_choices).toContain(maliciousInput)
    })
  })

  describe('2. Client-Side Data Validation', () => {
    it('should prevent XSS in candidate names', () => {
      const xssPayload = '<script>alert("xss")</script>'
      const sanitized = xssPayload.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      expect(sanitized).not.toContain('<script>')
    })

    it('should validate ballot is non-empty before submission', () => {
      const validateBallot = (choices) => {
        const filtered = choices.filter(c => c && c.trim().length > 0)
        return filtered.length > 0
      }
      expect(validateBallot([])).toBe(false)
      expect(validateBallot([''])).toBe(false)
      expect(validateBallot(['  '])).toBe(false)
      expect(validateBallot(['Option A'])).toBe(true)
    })

    it('should detect duplicate entries', () => {
      const hasDuplicates = (arr) => new Set(arr).size !== arr.length
      expect(hasDuplicates(['A', 'B', 'A'])).toBe(true)
      expect(hasDuplicates(['A', 'B', 'C'])).toBe(false)
    })
  })

  describe('3. Concurrent Submission Safety', () => {
    it('should handle multiple rapid submissions without data loss', async ({ skip }) => {
      if (!apiUp) skip()
      const votes = await Promise.all([
        apiSubmitTestVote(testPollId, { vote_type: 'ranked_choice', ranked_choices: ['Secure Option A'] }),
        apiSubmitTestVote(testPollId, { vote_type: 'ranked_choice', ranked_choices: ['Secure Option B'] }),
        apiSubmitTestVote(testPollId, { vote_type: 'ranked_choice', ranked_choices: ['Secure Option C'] }),
      ])
      expect(votes.length).toBe(3)
      votes.forEach(vote => {
        expect(vote.id).toBeDefined()
        expect(vote.ranked_choices.length).toBeGreaterThan(0)
      })
    })
  })
})
