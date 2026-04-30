// Database/API helpers for tests
// Tests that need a running Python API server use these helpers.
// Tests are skipped gracefully when no server is available.
//
// Phase 5: legacy `POST /api/questions` was removed; every question lives inside a
// poll wrapper. These helpers wrap a 1-question poll for each
// `apiCreateTestQuestion` call and route votes/close through the poll
// endpoints. The returned object is the question (Question-shaped) augmented
// with `_poll_id` so subsequent helpers can target the wrapper.

const TEST_API_BASE = process.env.TEST_API_URL || 'http://localhost:8000/api/questions'
const TEST_POLL_BASE = TEST_API_BASE.replace('/api/questions', '/api/polls')

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
    const res = await fetch(TEST_API_BASE.replace('/api/questions', '/health'), {
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
 * Helper: create a question via the Python API. Wraps a 1-question poll
 * around the legacy params shape so existing tests don't have to be rewritten.
 * Returns the question augmented with `_poll_id` (used by subsequent
 * `apiCloseQuestion` / `apiSubmitTestVote` calls).
 */
export async function apiCreateTestQuestion(params) {
  const {
    title,
    question_type,
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
    // Migration 098: poll-level results-display + ranked-choice settings.
    min_responses,
    show_preliminary_results,
    allow_pre_ranking,
    questions: [
      {
        question_type: question_type || 'yes_no',
        category: category || 'custom',
        options,
        options_metadata,
        suggestion_deadline_minutes,
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
  const res = await fetch(TEST_POLL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to create question: ${res.status} ${detail}`)
  }
  const poll = await res.json()
  const sub = poll.questions[0]
  sub._poll_id = poll.id
  return sub
}

/**
 * Helper: submit a vote via the poll batch endpoint.
 * `questionId` is the question id; the helper looks up the poll either via
 * `params._poll_id` (when provided) or fetches the question first.
 */
export async function apiSubmitTestVote(questionId, params) {
  const { _poll_id, voter_name, ...item } = params
  let pollId = _poll_id
  if (!pollId) {
    const questionRes = await fetch(`${TEST_API_BASE}/${questionId}`)
    if (!questionRes.ok) {
      // Surface as a "submit vote" error so callers see a consistent message.
      throw new Error(`Failed to submit vote: ${questionRes.status} ${await questionRes.text()}`)
    }
    pollId = (await questionRes.json()).poll_id
  }
  const res = await fetch(`${TEST_POLL_BASE}/${pollId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voter_name,
      items: [{ question_id: questionId, ...item }],
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
 * Helper: close a question via the poll close endpoint.
 * `questionId` may be either a question id (we fetch the poll_id) or already
 * carry `_poll_id` if the caller knows it.
 */
export async function apiCloseQuestion(questionId, creatorSecret, pollId) {
  let mpId = pollId
  if (!mpId) {
    const questionRes = await fetch(`${TEST_API_BASE}/${questionId}`)
    if (!questionRes.ok) throw new Error(`Failed to fetch question: ${questionRes.status}`)
    mpId = (await questionRes.json()).poll_id
  }
  const res = await fetch(`${TEST_POLL_BASE}/${mpId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creator_secret: creatorSecret, close_reason: 'manual' }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to close question: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: get question results via the Python API.
 */
export async function apiGetResults(questionId) {
  const res = await fetch(`${TEST_API_BASE}/${questionId}/results`)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to get results: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: get votes for a question via the Python API.
 */
export async function apiGetVotes(questionId) {
  const res = await fetch(`${TEST_API_BASE}/${questionId}/votes`)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to get votes: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: edit an existing vote via the poll batch endpoint.
 */
export async function apiEditTestVote(questionId, voteId, params) {
  const { _poll_id, voter_name, ...item } = params
  let pollId = _poll_id
  if (!pollId) {
    const questionRes = await fetch(`${TEST_API_BASE}/${questionId}`)
    if (!questionRes.ok) throw new Error(`Failed to fetch question: ${questionRes.status}`)
    pollId = (await questionRes.json()).poll_id
  }
  const res = await fetch(`${TEST_POLL_BASE}/${pollId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voter_name,
      items: [{ question_id: questionId, vote_id: voteId, ...item }],
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

export async function cleanupTestQuestions() {
  // No-op: test questions are cleaned up by the server or left as test data
}

export async function ensureMigrationsApplied() {
  // No-op: migrations managed on droplet
}
