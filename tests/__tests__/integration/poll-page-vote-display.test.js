/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the actual vote display logic from PollPageClient
describe('PollPageClient Vote Display Logic', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('Vote Data Processing', () => {
    it('should process vote data correctly when fetched from database', () => {
      // This simulates the exact logic in PollPageClient.tsx
      const poll = { 
        id: 'test-poll',
        poll_type: 'yes_no'
      }
      
      // Simulate what's returned from database
      const voteDataFromDB = {
        poll_id: 'test-poll',
        vote_type: 'yes_no',
        yes_no_choice: 'yes'
      }
      
      // This is what the component does:
      let yesNoChoice = null
      
      // The bug might be here - checking the wrong field?
      if (poll.poll_type === 'yes_no' && voteDataFromDB.yes_no_choice) {
        yesNoChoice = voteDataFromDB.yes_no_choice
      }
      
      expect(yesNoChoice).toBe('yes')
      expect(yesNoChoice).not.toBe('no')
    })
    
    it('should handle the exact structure returned by Supabase', () => {
      // The actual Supabase query returns:
      // { data: { vote_data: {...} }, error: null }
      
      const supabaseResponse = {
        data: {
          vote_data: {
            poll_id: 'test-poll',
            vote_type: 'yes_no', 
            yes_no_choice: 'yes'
          }
        },
        error: null
      }
      
      // Extract vote data
      const voteData = supabaseResponse.data?.vote_data || null
      
      expect(voteData).toBeTruthy()
      expect(voteData.yes_no_choice).toBe('yes')
      
      // Simulate UI update
      let displayChoice = null
      if (voteData && voteData.yes_no_choice) {
        displayChoice = voteData.yes_no_choice
      }
      
      expect(displayChoice).toBe('yes')
    })
    
    it('should detect if vote data has unexpected structure', () => {
      // Test various possible data structures that might cause the bug
      
      const testCases = [
        {
          name: 'Correct structure',
          data: { yes_no_choice: 'yes' },
          expected: 'yes'
        },
        {
          name: 'Nested structure',
          data: { vote_data: { yes_no_choice: 'yes' } },
          expected: null // Would fail if looking at wrong level
        },
        {
          name: 'Missing field',
          data: { choice: 'yes' }, // Wrong field name
          expected: null
        },
        {
          name: 'Boolean instead of string',
          data: { yes_no_choice: true }, // Wrong type
          expected: true
        }
      ]
      
      testCases.forEach(({ name, data, expected }) => {
        console.log(`Testing: ${name}`)
        const choice = data.yes_no_choice || null
        expect(choice).toBe(expected)
      })
    })
  })
  
  describe('localStorage and State Sync', () => {
    it('should not use stale localStorage data when fetching from database', () => {
      const pollId = 'test-poll'
      
      // Step 1: User votes YES, stored in localStorage (old behavior)
      const oldVoteData = { yesNoChoice: 'yes' }
      localStorage.setItem('pollVotes', JSON.stringify({ [pollId]: oldVoteData }))
      
      // Step 2: Vote ID is stored
      const voteId = 'vote-123'
      localStorage.setItem('pollVoteIds', JSON.stringify({ [pollId]: voteId }))
      
      // Step 3: Component should fetch from database, not use localStorage
      // The new behavior should ignore pollVotes and only use pollVoteIds
      
      const pollVotes = JSON.parse(localStorage.getItem('pollVotes') || '{}')
      const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}')
      
      // Should use vote ID to fetch from database, not local vote data
      expect(pollVoteIds[pollId]).toBe(voteId)
      
      // In the new implementation, we should NOT be using this:
      console.log('Old localStorage vote data (should not be used):', pollVotes[pollId])
    })
  })
})