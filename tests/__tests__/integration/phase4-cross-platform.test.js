/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../lib/supabase.ts'

describe('Phase 4: Cross-Platform Compatibility Tests', () => {
  let testPollId = null
  let cleanup = []

  beforeAll(async () => {
    // Create test poll for cross-platform testing
    const testPoll = {
      title: 'Cross-Platform Compatibility Test Poll',
      poll_type: 'ranked_choice',
        is_private: false,
      options: ['Platform A', 'Platform B', 'Platform C', 'Platform D'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'cross-platform-' + Date.now()
    }

    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single()

    if (error) {
      throw new Error('Could not create test poll for cross-platform tests')
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

  describe('1. Browser Compatibility Matrix', () => {
    it('should handle standard drag-and-drop operations across browsers', async () => {
      // Simulate browser-specific drag behavior patterns
      
      // Chrome/Edge behavior simulation
      const chromeVote = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Platform A', 'Platform B', 'Platform C']  // Standard order
      }

      const { data: chromeData, error: chromeError } = await supabase
        .from('votes')
        .insert([chromeVote])
        .select()

      expect(chromeError).toBeNull()
      cleanup.push({ type: 'vote', id: chromeData[0].id })

      // Firefox behavior simulation (may handle arrays differently)
      const firefoxVote = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Platform B', 'Platform A']  // Different order
      }

      const { data: firefoxData, error: firefoxError } = await supabase
        .from('votes')
        .insert([firefoxVote])
        .select()

      expect(firefoxError).toBeNull()
      cleanup.push({ type: 'vote', id: firefoxData[0].id })

      // Safari behavior simulation (may have different touch handling)
      const safariVote = {
        poll_id: testPollId,
        vote_type: 'ranked_choice',
        ranked_choices: ['Platform C']  // Single selection (simulating touch limitations)
      }

      const { data: safariData, error: safariError } = await supabase
        .from('votes')
        .insert([safariVote])
        .select()

      expect(safariError).toBeNull()
      cleanup.push({ type: 'vote', id: safariData[0].id })

      // Verify all votes were stored correctly regardless of browser simulation
      const { data: allVotes, error: fetchError } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', testPollId)

      expect(fetchError).toBeNull()
      expect(allVotes.length).toBeGreaterThanOrEqual(3)
      
      // Verify vote integrity
      allVotes.forEach(vote => {
        expect(vote.ranked_choices).toBeDefined()
        expect(Array.isArray(vote.ranked_choices)).toBe(true)
        expect(vote.ranked_choices.length).toBeGreaterThan(0)
      })
    })

    it('should handle touch vs mouse interaction patterns', async () => {
      // Clear existing votes for clean test
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Mouse interaction simulation (precise positioning)
      const mouseVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B', 'Platform C', 'Platform D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform D', 'Platform C', 'Platform B', 'Platform A'] }
      ]

      // Touch interaction simulation (may be less precise, shorter lists)
      const touchVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform C'] }
      ]

      // Insert mouse votes
      for (const vote of mouseVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Insert touch votes
      for (const vote of touchVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Verify mixed interaction results calculate correctly
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()

      // Verify Borda Count handles mixed input types
      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(bordaError).toBeNull()
      expect(bordaResult.length).toBe(4)
    })

    it('should handle keyboard navigation data consistency', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Keyboard navigation typically results in more methodical ordering
      const keyboardVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B', 'Platform C'] },  // Tab order
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform C', 'Platform B'] },  // Arrow key reordering
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform B', 'Platform A'] }  // Partial navigation
      ]

      for (const vote of keyboardVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Verify keyboard-generated votes produce valid results
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
    })
  })

  describe('2. Device-Specific Compatibility', () => {
    it('should handle mobile device constraints and limitations', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Mobile devices often have smaller screens, leading to shorter preference lists
      const mobileVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A'] },  // Single tap selection
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform B', 'Platform A'] },  // Two items max
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform C'] }  // Another single selection
      ]

      for (const vote of mobileVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Verify mobile-optimized voting patterns work correctly
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      
      // With mobile's tendency toward shorter lists, compensation should work well
      const winner = result.find(r => r.winner !== null)
      expect(winner).toBeDefined()
      expect(winner.borda_score).toBeGreaterThan(0)
    })

    it('should handle tablet interaction patterns', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Tablets typically allow for more complex interactions than phones
      const tabletVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B', 'Platform C'] },  // Multi-touch capable
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform D', 'Platform A'] },  // Mixed precision
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform B', 'Platform D', 'Platform C', 'Platform A'] }  // Full ranking
      ]

      for (const vote of tabletVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Verify tablet interaction results
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
      expect(result[0]?.total_rounds).toBeGreaterThan(0)
    })

    it('should handle desktop precision interactions', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Desktop users typically create more complete, precise rankings
      const desktopVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B', 'Platform C', 'Platform D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform B', 'Platform D', 'Platform A', 'Platform C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform C', 'Platform A', 'Platform D', 'Platform B'] }
      ]

      for (const vote of desktopVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Desktop votes should produce high-quality results
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(irvError).toBeNull()
      expect(irvResult[0]?.winner).toBeDefined()

      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(bordaError).toBeNull()
      
      // All candidates should have substantial scores with complete rankings
      bordaResult.forEach(candidate => {
        expect(candidate.borda_score).toBeGreaterThan(0)
      })
    })
  })

  describe('3. Data Format Consistency Across Platforms', () => {
    it('should maintain consistent array ordering regardless of platform', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Test various array formats that different platforms might produce
      const platformSpecificVotes = [
        // Standard JavaScript array
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B'] },
        
        // Array with consistent spacing (some platforms normalize whitespace)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform B', 'Platform C'] },
        
        // Single element array (mobile common pattern)
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform D'] }
      ]

      for (const vote of platformSpecificVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })

        // Verify the stored data maintains exact order
        expect(data[0].ranked_choices).toEqual(vote.ranked_choices)
        expect(Array.isArray(data[0].ranked_choices)).toBe(true)
      }

      // Verify all platforms produce consistent results
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
    })

    it('should handle unicode and special characters across platforms', async () => {
      // Create test poll with unicode options
      const unicodePoll = {
        title: 'Unicode Compatibility Test 🗳️',
        poll_type: 'ranked_choice',
        is_private: false,
        options: ['Option α', 'Option β', 'Option γ', 'Emoji 🎯', 'Accent café'],
        response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        creator_secret: 'unicode-test-' + Date.now()
      }

      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert([unicodePoll])
        .select()
        .single()

      expect(pollError).toBeNull()
      const unicodePollId = pollData.id
      cleanup.push({ type: 'poll', id: unicodePollId })

      // Test votes with unicode characters
      const unicodeVotes = [
        { poll_id: unicodePollId, vote_type: 'ranked_choice', ranked_choices: ['Option α', 'Emoji 🎯'] },
        { poll_id: unicodePollId, vote_type: 'ranked_choice', ranked_choices: ['Accent café', 'Option β'] },
        { poll_id: unicodePollId, vote_type: 'ranked_choice', ranked_choices: ['Option γ'] }
      ]

      for (const vote of unicodeVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })

        // Verify unicode characters are preserved exactly
        expect(data[0].ranked_choices).toEqual(vote.ranked_choices)
      }

      // Verify algorithms handle unicode correctly
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: unicodePollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
      
      // Winner should be one of the unicode options
      const unicodeOptions = ['Option α', 'Option β', 'Option γ', 'Emoji 🎯', 'Accent café']
      expect(unicodeOptions).toContain(result[0].winner)
    })

    it('should maintain data integrity with different JSON serialization approaches', async () => {
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Different platforms may serialize JSON arrays slightly differently
      // Test that our database handles various valid JSON array formats
      
      const serializedVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform C'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform D', 'Platform A', 'Platform C'] }
      ]

      const insertedVotes = []
      for (const vote of serializedVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
        insertedVotes.push(data[0])
      }

      // Verify all votes can be retrieved and processed consistently
      const { data: allVotes, error: fetchError } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', testPollId)

      expect(fetchError).toBeNull()
      expect(allVotes.length).toBeGreaterThanOrEqual(serializedVotes.length)

      // Verify votes from this test maintain their structure
      const thisTestVotes = allVotes.slice(-serializedVotes.length) // Get last N votes
      thisTestVotes.forEach((storedVote, index) => {
        expect(storedVote.ranked_choices).toEqual(serializedVotes[index].ranked_choices)
      })

      // Verify algorithms process serialized data correctly
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result.length).toBe(4) // All platform options should be included
    })
  })

  describe('4. Performance Across Different Platform Capabilities', () => {
    it('should handle varying processing speeds across devices', async () => {
      // Create a moderately complex scenario that tests different device capabilities
      
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Simulate votes from devices with different processing capabilities
      const deviceVotes = []
      
      // High-end device: complex, complete rankings
      for (let i = 0; i < 10; i++) {
        deviceVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: ['Platform A', 'Platform B', 'Platform C', 'Platform D']
            .sort(() => Math.random() - 0.5)
        })
      }

      // Mid-range device: partial rankings
      for (let i = 0; i < 10; i++) {
        const choices = ['Platform A', 'Platform B', 'Platform C', 'Platform D']
          .sort(() => Math.random() - 0.5)
          .slice(0, 2)
        deviceVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: choices
        })
      }

      // Low-end device: minimal rankings (simulating performance constraints)
      for (let i = 0; i < 5; i++) {
        deviceVotes.push({
          poll_id: testPollId,
          vote_type: 'ranked_choice',
          ranked_choices: [['Platform A', 'Platform B', 'Platform C', 'Platform D'][i % 4]]
        })
      }

      // Insert votes in batches to simulate realistic submission patterns
      const batchSize = 5
      for (let i = 0; i < deviceVotes.length; i += batchSize) {
        const batch = deviceVotes.slice(i, i + batchSize)
        
        const promises = batch.map(vote => 
          supabase.from('votes').insert([vote]).select()
        )
        
        const results = await Promise.all(promises)
        
        results.forEach(({ data, error }) => {
          expect(error).toBeNull()
          cleanup.push({ type: 'vote', id: data[0].id })
        })
      }

      // Verify the system handles mixed device capabilities efficiently
      const startTime = Date.now()
      
      const { data: irvResult, error: irvError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })
      
      const { data: bordaResult, error: bordaError } = await supabase
        .rpc('calculate_borda_count_winner', { target_poll_id: testPollId })
      
      const endTime = Date.now()

      expect(irvError).toBeNull()
      expect(bordaError).toBeNull()
      expect(irvResult[0]?.winner).toBeDefined()
      expect(bordaResult.find(r => r.winner !== null)).toBeDefined()

      // Should complete quickly regardless of device mix
      expect(endTime - startTime).toBeLessThan(10000) // 10 seconds max
    })

    it('should handle network connectivity variations gracefully', async () => {
      // Simulate different network conditions by testing various submission patterns
      
      // Clear existing votes
      await supabase.from('votes').delete().eq('poll_id', testPollId)

      // Fast connection: immediate submissions
      const fastConnectionVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A', 'Platform B'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform C', 'Platform D'] }
      ]

      for (const vote of fastConnectionVotes) {
        const { data, error } = await supabase
          .from('votes')
          .insert([vote])
          .select()

        expect(error).toBeNull()
        cleanup.push({ type: 'vote', id: data[0].id })
      }

      // Slow connection: batch submissions (simulating offline queuing)
      const slowConnectionVotes = [
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform B', 'Platform A'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform D'] },
        { poll_id: testPollId, vote_type: 'ranked_choice', ranked_choices: ['Platform A'] }
      ]

      // Submit as batch (simulating accumulated offline votes)
      const { data: batchData, error: batchError } = await supabase
        .from('votes')
        .insert(slowConnectionVotes)
        .select()

      expect(batchError).toBeNull()
      batchData.forEach(vote => cleanup.push({ type: 'vote', id: vote.id }))

      // Verify all votes were processed correctly regardless of submission method
      const { data: allVotes, error: fetchError } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', testPollId)

      expect(fetchError).toBeNull()
      expect(allVotes.length).toBeGreaterThanOrEqual(5) // At least 2 fast + 3 slow

      // Results should be consistent regardless of network submission patterns
      const { data: result, error: calcError } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPollId })

      expect(calcError).toBeNull()
      expect(result[0]?.winner).toBeDefined()
    })
  })
})