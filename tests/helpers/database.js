// Database/API helpers for tests
// Tests that need a running Python API server use these helpers.
// Tests are skipped gracefully when no server is available.
//
// Phase 5: legacy `POST /api/polls` was removed; every poll lives inside a
// multipoll wrapper. These helpers wrap a 1-sub-poll multipoll for each
// `apiCreateTestPoll` call and route votes/close through the multipoll
// endpoints. The returned object is the sub-poll (Poll-shaped) augmented
// with `_multipoll_id` so subsequent helpers can target the wrapper.

const TEST_API_BASE = process.env.TEST_API_URL || 'http://localhost:8000/api/polls'
const TEST_MULTIPOLL_BASE = TEST_API_BASE.replace('/api/polls', '/api/multipolls')

let _apiAvailable = null

/**
 * Check if the Python API server is reachable.
 * Caches result for the test run.
 */
export async function isApiAvailable() {
  if (_apiAvailable !== null) return _apiAvailable

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(TEST_API_BASE.replace('/api/polls', '/health'), {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    _apiAvailable = res.ok
  } catch {
    _apiAvailable = false
  }

  return _apiAvailable
}

/**
 * Get the test API base URL.
 */
export function getApiBase() {
  return TEST_API_BASE
}

/**
 * Helper: create a poll via the Python API. Wraps a 1-sub-poll multipoll
 * around the legacy params shape so existing tests don't have to be rewritten.
 * Returns the sub-poll augmented with `_multipoll_id` (used by subsequent
 * `apiClosePoll` / `apiSubmitTestVote` calls).
 */
export async function apiCreateTestPoll(params) {
  const {
    title,
    poll_type,
    options,
    response_deadline,
    creator_secret,
    creator_name,
    follow_up_to,
    suggestion_deadline,
    suggestion_deadline_minutes,
    allow_pre_ranking,
    auto_close_after,
    details,
    day_time_windows,
    duration_window,
    category,
    options_metadata,
    reference_latitude,
    reference_longitude,
    reference_location_label,
    min_responses,
    show_preliminary_results,
    min_availability_percent,
    is_auto_title,
    thread_title,
    ...rest
  } = params
  const body = {
    creator_secret,
    creator_name,
    response_deadline,
    follow_up_to,
    title,
    thread_title,
    prephase_deadline: suggestion_deadline,
    prephase_deadline_minutes: suggestion_deadline_minutes,
    sub_polls: [
      {
        poll_type: poll_type || 'yes_no',
        category: category || 'custom',
        options,
        options_metadata,
        suggestion_deadline_minutes,
        allow_pre_ranking,
        min_responses,
        show_preliminary_results,
        min_availability_percent: min_availability_percent ?? 95,
        day_time_windows,
        duration_window,
        reference_latitude,
        reference_longitude,
        reference_location_label,
        is_auto_title,
        ...rest,
      },
    ],
  }
  const res = await fetch(TEST_MULTIPOLL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to create poll: ${res.status} ${detail}`)
  }
  const multipoll = await res.json()
  const sub = multipoll.sub_polls[0]
  sub._multipoll_id = multipoll.id
  return sub
}

/**
 * Helper: submit a vote via the multipoll batch endpoint.
 * `pollId` is the sub-poll id; the helper looks up the multipoll either via
 * `params._multipoll_id` (when provided) or fetches the sub-poll first.
 */
export async function apiSubmitTestVote(pollId, params) {
  const { _multipoll_id, voter_name, ...item } = params
  let multipollId = _multipoll_id
  if (!multipollId) {
    const pollRes = await fetch(`${TEST_API_BASE}/${pollId}`)
    if (!pollRes.ok) {
      // Surface as a "submit vote" error so callers see a consistent message.
      throw new Error(`Failed to submit vote: ${pollRes.status} ${await pollRes.text()}`)
    }
    multipollId = (await pollRes.json()).multipoll_id
  }
  const res = await fetch(`${TEST_MULTIPOLL_BASE}/${multipollId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voter_name,
      items: [{ sub_poll_id: pollId, ...item }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to submit vote: ${res.status} ${detail}`)
  }
  const arr = await res.json()
  return arr[0]
}

/**
 * Helper: close a poll via the multipoll close endpoint.
 * `pollId` may be either a sub-poll id (we fetch the multipoll_id) or already
 * carry `_multipoll_id` if the caller knows it.
 */
export async function apiClosePoll(pollId, creatorSecret, multipollId) {
  let mpId = multipollId
  if (!mpId) {
    const pollRes = await fetch(`${TEST_API_BASE}/${pollId}`)
    if (!pollRes.ok) throw new Error(`Failed to fetch poll: ${pollRes.status}`)
    mpId = (await pollRes.json()).multipoll_id
  }
  const res = await fetch(`${TEST_MULTIPOLL_BASE}/${mpId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creator_secret: creatorSecret, close_reason: 'manual' }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to close poll: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: get poll results via the Python API.
 */
export async function apiGetResults(pollId) {
  const res = await fetch(`${TEST_API_BASE}/${pollId}/results`)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to get results: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: get votes for a poll via the Python API.
 */
export async function apiGetVotes(pollId) {
  const res = await fetch(`${TEST_API_BASE}/${pollId}/votes`)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to get votes: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: edit an existing vote via the multipoll batch endpoint.
 */
export async function apiEditTestVote(pollId, voteId, params) {
  const { _multipoll_id, voter_name, ...item } = params
  let multipollId = _multipoll_id
  if (!multipollId) {
    const pollRes = await fetch(`${TEST_API_BASE}/${pollId}`)
    if (!pollRes.ok) throw new Error(`Failed to fetch poll: ${pollRes.status}`)
    multipollId = (await pollRes.json()).multipoll_id
  }
  const res = await fetch(`${TEST_MULTIPOLL_BASE}/${multipollId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voter_name,
      items: [{ sub_poll_id: pollId, vote_id: voteId, ...item }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to edit vote: ${res.status} ${detail}`)
  }
  const arr = await res.json()
  return arr[0]
}

// Legacy stubs — no longer needed
export function getTestDatabase() {
  throw new Error('Supabase removed. Use API helpers from this module.')
}

export async function cleanupTestPolls() {
  // No-op: test polls are cleaned up by the server or left as test data
}

export async function ensureMigrationsApplied() {
  // No-op: migrations managed on droplet
}
