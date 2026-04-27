import { apiCreateTestQuestion, apiSubmitTestVote, apiCloseQuestion, apiGetResults } from './database.js'
import { expect } from 'vitest'

export function createQuestion(options) {
  return new QuestionBuilder(options)
}

class QuestionBuilder {
  constructor(options) {
    this.questionOptions = options
    this.votes = []
    this.expectedRounds = []
    this.expectedWinner = null
    this.testQuestionId = null
    this.creatorSecret = null
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
    // Step 1: Create test question via API
    this.creatorSecret = `test-secret-${Date.now()}-${Math.random()}`
    const question = await apiCreateTestQuestion({
      title: `Test Question ${Date.now()}`,
      question_type: 'ranked_choice',
      options: this.questionOptions,
      creator_secret: this.creatorSecret,
    })

    this.testQuestionId = question.id

    // Step 2: Insert votes via API
    for (const voteArray of this.votes) {
      await apiSubmitTestVote(question.id, {
        vote_type: 'ranked_choice',
        ranked_choices: voteArray,
        _poll_id: question._poll_id,
      })
    }

    // Step 3: Close question to trigger IRV calculation, then get results
    await apiCloseQuestion(question.id, this.creatorSecret, question._poll_id)
    const results = await apiGetResults(question.id)

    // Step 4: Assert expected results
    this._assertResults(results)

    return {
      winner: results.ranked_choice_winner,
      totalRounds: results.ranked_choice_rounds
        ? Math.max(...results.ranked_choice_rounds.map(r => r.round_number))
        : 0,
      rounds: this._formatRounds(results.ranked_choice_rounds || []),
    }
  }

  _assertResults(results) {
    const rounds = results.ranked_choice_rounds || []
    const winner = results.ranked_choice_winner

    // Check winner if specified
    if (this.expectedWinner !== null) {
      expect(winner).toBe(this.expectedWinner)
    }

    // Check round-by-round results
    for (const expectedRound of this.expectedRounds) {
      if (expectedRound.winner) {
        expect(winner).toBe(expectedRound.winner)
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
        eliminated: round.is_eliminated,
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
