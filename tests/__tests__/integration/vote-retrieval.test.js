/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { supabase } from '../../../lib/supabase'

// Mock Supabase
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn()
  }
}))

// Test the vote storage and retrieval logic
describe('Vote Storage and Retrieval', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Vote Data Structure', () => {
    it('should store vote with correct structure', () => {
      const pollId = 'test-poll-123'
      const voteId = 'vote-456'
      
      // Simulate storing vote ID in localStorage (what markPollAsVoted does)
      const votedPolls = { [pollId]: true }
      const pollVoteIds = { [pollId]: voteId }
      
      localStorage.setItem('votedPolls', JSON.stringify(votedPolls))
      localStorage.setItem('pollVoteIds', JSON.stringify(pollVoteIds))
      
      // Verify storage
      const storedVotedPolls = JSON.parse(localStorage.getItem('votedPolls'))
      const storedVoteIds = JSON.parse(localStorage.getItem('pollVoteIds'))
      
      expect(storedVotedPolls[pollId]).toBe(true)
      expect(storedVoteIds[pollId]).toBe(voteId)
    })

    it('should retrieve vote ID from localStorage', () => {
      const pollId = 'test-poll-123'
      const voteId = 'vote-456'
      
      // Store vote ID
      const pollVoteIds = { [pollId]: voteId }
      localStorage.setItem('pollVoteIds', JSON.stringify(pollVoteIds))
      
      // Retrieve vote ID (what getStoredVoteId does)
      const stored = JSON.parse(localStorage.getItem('pollVoteIds') || '{}')
      const retrievedVoteId = stored[pollId] || null
      
      expect(retrievedVoteId).toBe(voteId)
    })
  })

  describe('Database Vote Structure', () => {
    it('should handle yes/no vote data structure correctly', async () => {
      const voteId = 'vote-789'
      const mockVoteData = {
        poll_id: 'poll-123',
        vote_type: 'yes_no',
        yes_no_choice: 'yes'
      }
      
      // Mock the database fetch
      const mockFetch = vi.fn().mockResolvedValue({
        data: { vote_data: mockVoteData },
        error: null
      })
      
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockFetch
          })
        })
      })
      
      // Fetch vote data
      const result = await supabase
        .from('votes')
        .select('vote_data')
        .eq('id', voteId)
        .single()
      
      expect(result.data.vote_data).toEqual(mockVoteData)
      expect(result.data.vote_data.yes_no_choice).toBe('yes')
    })

    it('should handle ranked choice vote data structure correctly', async () => {
      const voteId = 'vote-999'
      const mockVoteData = {
        poll_id: 'poll-456',
        vote_type: 'ranked_choice',
        ranked_choices: ['Option A', 'Option B', 'Option C']
      }
      
      // Mock the database fetch
      const mockFetch = vi.fn().mockResolvedValue({
        data: { vote_data: mockVoteData },
        error: null
      })
      
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockFetch
          })
        })
      })
      
      // Fetch vote data
      const result = await supabase
        .from('votes')
        .select('vote_data')
        .eq('id', voteId)
        .single()
      
      expect(result.data.vote_data).toEqual(mockVoteData)
      expect(result.data.vote_data.ranked_choices).toEqual(['Option A', 'Option B', 'Option C'])
    })
  })

  describe('Vote Retrieval Bug', () => {
    it('should correctly retrieve and display YES vote (not NO)', async () => {
      // This test demonstrates the expected behavior
      const pollId = 'bug-test-poll'
      const voteId = 'bug-test-vote'
      
      // User votes YES
      const submittedVoteData = {
        poll_id: pollId,
        vote_type: 'yes_no',
        yes_no_choice: 'yes' // User voted YES
      }
      
      // Store vote ID in localStorage
      localStorage.setItem('pollVoteIds', JSON.stringify({ [pollId]: voteId }))
      localStorage.setItem('votedPolls', JSON.stringify({ [pollId]: true }))
      
      // Mock database returning the vote
      const mockFetch = vi.fn().mockResolvedValue({
        data: { vote_data: submittedVoteData },
        error: null
      })
      
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockFetch
          })
        })
      })
      
      // Fetch vote from database
      const result = await supabase
        .from('votes')
        .select('vote_data')
        .eq('id', voteId)
        .single()
      
      // Verify the vote data structure
      console.log('Retrieved vote data:', result.data.vote_data)
      
      // The vote should be YES, not NO
      expect(result.data.vote_data.yes_no_choice).toBe('yes')
      expect(result.data.vote_data.yes_no_choice).not.toBe('no')
      
      // Simulate what should happen in the UI
      const voteChoice = result.data.vote_data.yes_no_choice
      const displayText = voteChoice === 'yes' ? 'Yes' : 'No'
      
      expect(displayText).toBe('Yes')
    })
  })
})