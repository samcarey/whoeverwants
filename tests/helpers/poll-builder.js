import { getTestDatabase } from './database.js'
import { expect } from 'vitest'

export function createPoll(options) {
  return new PollBuilder(options)
}

class PollBuilder {
  constructor(options) {
    this.pollOptions = options
    this.votes = []
    this.expectedRounds = []
    this.expectedWinner = null
    this.testPollId = null
  }

  withVotes(voteArrays) {
    this.votes = voteArrays
    return this
  }

  expectRounds(rounds) {
    this.expectedRounds = rounds
    return this
  }

  expectWinner(winner) {
    this.expectedWinner = winner
    return this
  }

  async run() {
    const db = getTestDatabase()
    
    try {
      // Step 1: Create test poll
      const { data: poll, error: pollError } = await db
        .from('polls')
        .insert({
          title: `Test Poll ${Date.now()}`,
          poll_type: 'ranked_choice',
          options: this.pollOptions,
          is_private: false // Make test polls public for easier testing
        })
        .select()
        .single()

      if (pollError) throw new Error(`Failed to create poll: ${pollError.message}`)
      this.testPollId = poll.id

      // Step 2: Insert votes
      for (const voteArray of this.votes) {
        const { error: voteError } = await db
          .from('votes')
          .insert({
            poll_id: poll.id,
            vote_type: 'ranked_choice',
            ranked_choices: voteArray
          })

        if (voteError) throw new Error(`Failed to insert vote: ${voteError.message}`)
      }

      // Step 3: Calculate results
      const { data: result, error: calcError } = await db
        .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

      if (calcError) throw new Error(`Calculation failed: ${calcError.message}`)

      // Step 4: Get detailed rounds
      const { data: rounds, error: roundsError } = await db
        .from('ranked_choice_rounds')
        .select('*')
        .eq('poll_id', poll.id)
        .order('round_number')
        .order('vote_count', { ascending: false })

      if (roundsError) throw new Error(`Failed to get rounds: ${roundsError.message}`)

      // Step 5: Assert expected results
      this._assertResults(result[0], rounds)

      return {
        winner: result[0].winner,
        totalRounds: result[0].total_rounds,
        rounds: this._formatRounds(rounds)
      }
    } finally {
      // Always cleanup
      if (this.testPollId) {
        await db.from('polls').delete().eq('id', this.testPollId)
      }
    }
  }

  _assertResults(result, rounds) {
    // Check winner if specified
    if (this.expectedWinner !== null) {
      expect(result.winner).toBe(this.expectedWinner)
    }

    // Check round-by-round results
    for (const expectedRound of this.expectedRounds) {
      if (expectedRound.winner) {
        expect(result.winner).toBe(expectedRound.winner)
        continue
      }

      const actualRound = rounds.filter(r => r.round_number === expectedRound.round)
      expect(actualRound.length).toBeGreaterThan(0)

      for (const [candidate, expectedVotes, expectedEliminated] of expectedRound.results) {
        const candidateResult = actualRound.find(r => r.option_name === candidate)
        
        expect(candidateResult, `Candidate ${candidate} not found in round ${expectedRound.round}`).toBeDefined()
        expect(candidateResult.vote_count, `${candidate} vote count mismatch in round ${expectedRound.round}`).toBe(expectedVotes)
        expect(candidateResult.is_eliminated, `${candidate} elimination status mismatch in round ${expectedRound.round}`).toBe(expectedEliminated)
      }
    }
  }

  _formatRounds(rounds) {
    const formatted = {}
    for (const round of rounds) {
      if (!formatted[round.round_number]) {
        formatted[round.round_number] = []
      }
      formatted[round.round_number].push({
        candidate: round.option_name,
        votes: round.vote_count,
        eliminated: round.is_eliminated
      })
    }
    return formatted
  }
}

// Helper for common vote patterns
export const votePatterns = {
  // Ties where some candidates have 0 votes
  zeroVoteTie: (winners, zeroCandidates) => [
    ...winners.map((w, i) => [w, ...zeroCandidates]),
    ...winners.slice(1).map((w, i) => [winners[(i + 1) % winners.length], ...zeroCandidates])
  ],
  
  // Clear majority winner
  majorityWinner: (winner, others) => [
    [winner, ...others],
    [winner, ...others.reverse()],
    [winner, ...others]
  ],
  
  // Complex redistribution
  redistribution: (first, second, others) => [
    [first, second, ...others],
    [second, first, ...others],
    [others[0], first, second, ...others.slice(1)]
  ]
}