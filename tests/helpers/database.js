// Database/API helpers for tests
// Tests that need a running Python API server use these helpers.
// Tests are skipped gracefully when no server is available.

const TEST_API_BASE = process.env.TEST_API_URL || 'http://localhost:8000/api/polls'

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
 * Helper: create a poll via the Python API.
 */
export async function apiCreateTestPoll(params) {
  const res = await fetch(TEST_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to create poll: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: submit a vote via the Python API.
 */
export async function apiSubmitTestVote(pollId, params) {
  const res = await fetch(`${TEST_API_BASE}/${pollId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to submit vote: ${res.status} ${detail}`)
  }
  return res.json()
}

/**
 * Helper: close a poll via the Python API (triggers IRV calculation).
 */
export async function apiClosePoll(pollId, creatorSecret) {
  const res = await fetch(`${TEST_API_BASE}/${pollId}/close`, {
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
 * Helper: edit an existing vote via the Python API.
 */
export async function apiEditTestVote(pollId, voteId, params) {
  const res = await fetch(`${TEST_API_BASE}/${pollId}/votes/${voteId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to edit vote: ${res.status} ${detail}`)
  }
  return res.json()
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
