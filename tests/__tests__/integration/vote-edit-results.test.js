/**
 * @vitest-environment jsdom
 *
 * Tests that poll results correctly reflect edited votes.
 * Regression test for: preliminary results not updating after vote edits
 * because fetchPollResults() was gated by a stale closure value.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  isApiAvailable,
  apiCreateTestPoll,
  apiSubmitTestVote,
  apiEditTestVote,
  apiGetResults,
} from '../../helpers/database.js'

let apiUp = false

beforeAll(async () => {
  apiUp = await isApiAvailable()
})

describe('Vote Edit Results Update', () => {
  it('ranked choice results should reflect edited vote', async () => {
    if (!apiUp) return

    // Create a 2-option ranked choice poll with preliminary results enabled
    const poll = await apiCreateTestPoll({
      title: 'Vote Edit Test - ' + Date.now(),
      poll_type: 'ranked_choice',
      options: ['Alpha', 'Beta'],
      creator_secret: 'edit-test-secret-' + Date.now(),
      show_preliminary_results: true,
      min_responses: 1,
    })

    // Submit initial votes: 2 for Alpha, 1 for Beta
    const vote1 = await apiSubmitTestVote(poll.id, {
      vote_type: 'ranked_choice',
      ranked_choices: ['Alpha', 'Beta'],
      voter_name: 'Voter1',
      is_abstain: false,
    })
    await apiSubmitTestVote(poll.id, {
      vote_type: 'ranked_choice',
      ranked_choices: ['Alpha', 'Beta'],
      voter_name: 'Voter2',
      is_abstain: false,
    })
    await apiSubmitTestVote(poll.id, {
      vote_type: 'ranked_choice',
      ranked_choices: ['Beta', 'Alpha'],
      voter_name: 'Voter3',
      is_abstain: false,
    })

    // Verify initial results: Alpha should be winning
    const resultsBefore = await apiGetResults(poll.id)
    expect(resultsBefore.winner).toBe('Alpha')

    // Edit vote1 from Alpha to Beta
    await apiEditTestVote(poll.id, vote1.id, {
      ranked_choices: ['Beta', 'Alpha'],
      voter_name: 'Voter1',
      is_abstain: false,
    })

    // Fetch results again — they MUST reflect the edit
    const resultsAfter = await apiGetResults(poll.id)
    expect(resultsAfter.winner).toBe('Beta')
  })

  it('yes/no results should reflect edited vote', async () => {
    if (!apiUp) return

    const poll = await apiCreateTestPoll({
      title: 'Yes/No Edit Test - ' + Date.now(),
      poll_type: 'yes_no',
      options: ['Yes', 'No'],
      creator_secret: 'yn-edit-test-' + Date.now(),
      show_preliminary_results: true,
      min_responses: 1,
    })

    // Submit: 2 yes, 1 no
    const vote1 = await apiSubmitTestVote(poll.id, {
      vote_type: 'yes_no',
      yes_no_choice: 'yes',
      voter_name: 'Alice',
      is_abstain: false,
    })
    await apiSubmitTestVote(poll.id, {
      vote_type: 'yes_no',
      yes_no_choice: 'yes',
      voter_name: 'Bob',
      is_abstain: false,
    })
    await apiSubmitTestVote(poll.id, {
      vote_type: 'yes_no',
      yes_no_choice: 'no',
      voter_name: 'Carol',
      is_abstain: false,
    })

    const resultsBefore = await apiGetResults(poll.id)
    expect(resultsBefore.yes_count).toBe(2)
    expect(resultsBefore.no_count).toBe(1)

    // Edit vote1 from yes to no
    await apiEditTestVote(poll.id, vote1.id, {
      yes_no_choice: 'no',
      voter_name: 'Alice',
      is_abstain: false,
    })

    const resultsAfter = await apiGetResults(poll.id)
    expect(resultsAfter.yes_count).toBe(1)
    expect(resultsAfter.no_count).toBe(2)
  })

  it('results should update when vote changes to abstain', async () => {
    if (!apiUp) return

    const poll = await apiCreateTestPoll({
      title: 'Abstain Edit Test - ' + Date.now(),
      poll_type: 'ranked_choice',
      options: ['Red', 'Blue'],
      creator_secret: 'abstain-edit-test-' + Date.now(),
      show_preliminary_results: true,
      min_responses: 1,
    })

    const vote1 = await apiSubmitTestVote(poll.id, {
      vote_type: 'ranked_choice',
      ranked_choices: ['Red', 'Blue'],
      voter_name: 'Voter1',
      is_abstain: false,
    })
    await apiSubmitTestVote(poll.id, {
      vote_type: 'ranked_choice',
      ranked_choices: ['Blue', 'Red'],
      voter_name: 'Voter2',
      is_abstain: false,
    })

    const resultsBefore = await apiGetResults(poll.id)
    expect(resultsBefore.total_votes).toBe(2)

    // Edit vote1 to abstain
    await apiEditTestVote(poll.id, vote1.id, {
      ranked_choices: null,
      voter_name: 'Voter1',
      is_abstain: true,
    })

    const resultsAfter = await apiGetResults(poll.id)
    // Abstain votes are still counted in total_votes but shouldn't affect the winner
    expect(resultsAfter.winner).toBe('Blue')
  })
})
