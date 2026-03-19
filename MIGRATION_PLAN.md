# WhoeverWants: Server Migration Plan

> This document tracks the migration from a Supabase-only architecture to a Python server + Postgres backend. It is automatically discovered by Claude sessions via the project root.

**Status**: Active — Phase 2A
**Last updated**: 2026-03-19
**Current phase**: Phase 2A (Yes/No polls — full vertical slice)

---

## Architecture Overview

### Previous (Supabase-only) — NOW DELETED
```
Browser (Next.js) ──► @supabase/supabase-js ──► Supabase Cloud (PERMANENTLY DELETED)
```

Both Supabase projects (test: kfngceqepnzlljkwedtd, production: kifnvombihyfwszuwqvy) have been permanently deleted. All cloud data is gone. The app is currently non-functional.

### Target (Python server + local Postgres)
```
Browser (Next.js) ──► Python API (FastAPI) ──► PostgreSQL (local)
                      ├── Poll result calculations     (data storage only,
                      ├── IRV/ranked choice algorithm    no business logic
                      ├── Participation priority          in SQL)
                      ├── Vote validation
                      └── Auto-close logic
```

### Migration Strategy Change

With Supabase deleted, the original incremental approach (PostgREST compatibility layer → gradual migration) no longer makes sense. Instead we go **direct to target architecture**:

1. Stand up server with Postgres + Python API
2. Port algorithms to Python
3. Update frontend to call Python API instead of supabase-js
4. Remove supabase-js dependency

No data to migrate. No fallback to maintain. Clean break.

---

## Phases

### ~~Phase 0: Restore & Baseline~~ — SKIPPED
Supabase projects permanently deleted. No baseline to restore. Moving directly to server setup.

### Phase 1: Server Infrastructure ✓ COMPLETE
**Goal**: Stand up a cheap cloud server with Docker, Postgres, and Python API.

- [x] **Choose hosting**: DigitalOcean $6/mo droplet (1GB RAM, 24GB disk, Ubuntu 24.04)
- [x] **User action required**: Droplet provisioned, remote execution API running
- [x] **Remote access**: Claude has full remote command execution via `scripts/remote.sh` (HTTPS API with bearer token auth, credentials in `.env`)
- [x] **Store credentials**: `DROPLET_API_URL` and `DROPLET_API_TOKEN` in `.env`, documented in `CLAUDE.md`
- [x] **Clone repo on droplet**: `/root/whoeverwants` cloned, git pull workflow ready
- [x] **Provision server**: Docker Compose with Postgres 16, FastAPI, Caddy (HTTPS reverse proxy for `whoeverwants.com`)
- [x] **Apply database schema**: All 74 up-migrations applied (some Supabase-specific role errors are non-fatal)
- [x] **Git-based deployment**: `git pull` + `docker compose up -d --build` via `scripts/remote.sh`
- [x] **Verify**: API health check returns `{"status":"ok","database":"connected"}`

### Phase 2: Vertical Slices (Algorithm + API + Frontend per feature)

**Strategy change**: Instead of porting all algorithms first, then building the API, then migrating the frontend — we work in **vertical slices**. Each poll type gets its algorithm, API endpoints, and frontend wiring done together so it can be tested end-to-end before moving on to the next feature. This catches integration issues early.

#### SQL logic reference (by complexity):

| Component | SQL Location | Complexity | Strategy |
|-----------|-------------|------------|----------|
| Yes/No vote counting | `poll_results` view | Low | Simple aggregation |
| Nomination vote counting | Already in TypeScript | Low | Port to Python |
| `update_updated_at` trigger | Migration 001 | Low | Set in app layer |
| `get_all_related_poll_ids()` | Migration 017 | Low | Recursive tree walk |
| `calculate_valid_participation_votes()` | Migration 061 | Low | Wrapper function |
| Vote structure validation | Migration 053 constraints | Medium | Python validation |
| `auto_close_participation_poll()` trigger | Migration 056 | Medium | Server-side logic |
| `poll_results` view (full) | Migration 058 | Medium | Python computation |
| `calculate_ranked_choice_winner()` | Migration 046 | **High** | IRV + Borda tiebreak |
| `calculate_participating_voters()` | Migration 063 | **High** | Recursive greedy priority |

Each algorithm gets its own Python module in `server/algorithms/` with a corresponding test file in `server/tests/`. Dependencies are managed with **uv** (`pyproject.toml` + `uv.lock`). Run tests with `uv run pytest`.

---

### Phase 2A: Yes/No Polls — Full Vertical Slice ← CURRENT
**Goal**: Get yes/no polls fully working through the new Python API, testable in the browser.

#### Algorithm
1. [x] **Yes/No vote counting** — `server/algorithms/yes_no.py` + tests. Counts yes/no/abstain, calculates percentages, determines winner. 12 tests passing.

#### API Endpoints
2. [x] **`POST /api/polls`** — Create a poll (all types, not just yes/no). Inserts into `polls` table, returns poll with `id` and `short_id`.
3. [x] **`GET /api/polls/by-short-id/{short_id}`** — Get poll by short ID. Returns poll data needed by `PollPageClient`.
4. [x] **`POST /api/polls/{id}/votes`** — Submit a vote. For yes/no: validates `yes_no_choice` ∈ {"yes", "no"} or `is_abstain=true`. Inserts into `votes` table.
5. [x] **`GET /api/polls/{id}/votes`** — Get votes for a poll (needed to check if current user already voted, and for voter list).
6. [x] **`PUT /api/polls/{id}/votes/{vote_id}`** — Edit an existing vote.
7. [x] **`GET /api/polls/{id}/results`** — Compute poll results using `count_yes_no_votes()`. Returns shape matching `PollResults` TypeScript interface.
8. [x] **`POST /api/polls/{id}/close`** — Close a poll (creator auth via `creator_secret`).
9. [x] **`POST /api/polls/{id}/reopen`** — Reopen a poll.
10. [x] **`POST /api/polls/accessible`** — List polls the user has access to (by poll IDs sent from client).

#### Frontend Migration
11. [x] **Add API client** — `lib/api.ts` with `fetch()`-based client pointing to Python API. Includes all CRUD operations, vote management, and results fetching.
12. [x] **Swap `getPollResults()`** — `PollPageClient.tsx` now calls `apiGetPollResults()` instead of Supabase.
13. [x] **Swap `submitVote()`** — Vote insert/edit in `PollPageClient.tsx` now uses `apiSubmitVote()` / `apiEditVote()`.
14. [x] **Swap `createPoll()`** — `create-poll/page.tsx` now uses `apiCreatePoll()`.
15. [x] **Swap poll fetch** — `page.tsx` uses `apiGetPollById()` / `apiGetPollByShortId()`. `simplePollQueries.ts` fully migrated.
16. [x] **Swap `closePoll()` / `reopenPoll()`** — `PollPageClient.tsx` now uses `apiClosePoll()` / `apiReopenPoll()`.

#### Deploy & Test
17. [ ] **Deploy to droplet** — `git pull` + `docker compose up -d --build` on droplet.
18. [ ] **End-to-end test** — Create a yes/no poll on `whoeverwants.com`, vote on it, verify results render correctly.

---

### Phase 2B: Nomination Polls
**Goal**: Get nomination polls fully working through the Python API.

1. [ ] **Nomination vote counting algorithm** — `server/algorithms/nomination.py` + tests. Port from `getNominationVoteCounts()` in `lib/supabase.ts`.
2. [ ] **Vote structure validation** — `server/algorithms/vote_validation.py` + tests. Enforce required/forbidden fields per poll type. Reference: migration 053.
3. [ ] **Extend API endpoints** — Add nomination-specific handling to vote submission/results endpoints.
4. [ ] **Frontend swap** — `getNominationVoteCounts()` calls Python API.
5. [ ] **Deploy & test** — Create nomination poll, nominate options, vote, verify.

---

### Phase 2C: Ranked Choice Polls
**Goal**: Get ranked choice (IRV) polls fully working through the Python API.

1. [ ] **IRV algorithm** — `server/algorithms/ranked_choice.py` + tests. IRV with Borda tiebreak + exhausted ballot handling. Validate against existing `tests/__tests__/ranked-choice/` and `tests/__tests__/voting-algorithms/`. Reference: migration 046.
2. [ ] **Extend API** — Ranked choice results endpoint, `calculate_ranked_choice_winner()` on poll close.
3. [ ] **Frontend swap** — `getRankedChoiceRounds()` and ranked-choice results via Python API.
4. [ ] **Deploy & test** — Create ranked choice poll, submit rankings, close poll, verify IRV rounds.

---

### Phase 2D: Participation Polls
**Goal**: Get participation polls fully working through the Python API.

1. [ ] **Participation priority algorithm** — `server/algorithms/participation.py` + tests. Greedy priority-based voter selection. Reference: migration 063 + CLAUDE.md philosophy section.
2. [ ] **`calculate_valid_participation_votes()`** — Wrapper around participation priority. Reference: migration 061.
3. [ ] **`auto_close_participation_poll()` trigger** — `server/algorithms/auto_close.py` + tests. Close when yes votes >= max_participants.
4. [ ] **Extend API** — Participation results, `getParticipatingVoters()`, auto-close logic.
5. [ ] **Frontend swap** — Participation results and voter list via Python API.
6. [ ] **Deploy & test** — Create participation poll with conditions, vote, verify priority algorithm.

---

### Phase 2E: Shared Features
**Goal**: Migrate remaining cross-cutting features.

1. [ ] **`update_updated_at`** — Handle in app layer (set `updated_at = NOW()` on update). No separate module needed.
2. [ ] **`get_all_related_poll_ids()`** — `server/algorithms/related_polls.py` + tests. Recursive tree walk for follow-up/fork chains. Reference: migration 017.
3. [ ] **Poll access tracking** — `GET /api/polls/accessible` using client-sent poll IDs.
4. [ ] **Frontend swap** — Related poll discovery, poll access, remaining Supabase calls.
5. [ ] **Deploy & test** — Follow-up/fork chains, poll list on homepage.

---

### Phase 3: Cleanup
**Goal**: Remove all Supabase dependencies.

- [ ] Remove `@supabase/supabase-js` from package.json
- [ ] Remove SQL stored procedures from migrations (logic lives in Python now)
- [ ] Simplify DB to pure data storage (tables + indexes, no views/functions/triggers)
- [ ] Remove Supabase env vars and legacy migration scripts
- [ ] Update tests to use Python API (pure unit tests, no Supabase dependency)

---

## Decisions & Constraints

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server language | Python | Avoid compile times, AI-friendly, rapid iteration |
| Web framework | FastAPI | Async, good typing, auto-docs |
| Python tooling | **uv** | Fast package management, lockfile, replaces pip/venv/poetry |
| Hosting | DigitalOcean $6/mo (1GB/24GB, Ubuntu 24.04) | Simple, cheap, full root access |
| Database | PostgreSQL (local) | Same dialect as Supabase, easy migration |
| Deployment | Git-based auto-deploy | Claude manages everything remotely |
| Development flow | Claude Code iOS app | No manual SSH — Claude has full control |
| Supabase fallback | None | Both projects permanently deleted |

---

## Lessons Learned

> Record important discoveries and gotchas here across sessions.

1. **No `.env` file in repo** — All Supabase credentials were provided out-of-band. DigitalOcean droplet credentials (`DROPLET_API_URL`, `DROPLET_API_TOKEN`) are pre-set as environment variables in the Claude Code web environment (not in a `.env` file). The `scripts/remote.sh` script checks env vars first, then falls back to `.env`.
2. **Container egress restrictions** — Claude Code's sandboxed environment blocks outbound connections to `supabase.co` (DNS blocked by egress proxy). Supabase connectivity checks and integration tests must be run locally or in CI.
3. **All tests are integration tests** — Every test suite in `tests/` talks to the real Supabase database. There are no pure unit tests that can run offline. Must be rewritten in Phase 5.
4. **Droplet env vars pre-set** — `DROPLET_API_URL` and `DROPLET_API_TOKEN` are pre-set as environment variables in the Claude Code web environment (not in a `.env` file). `scripts/remote.sh` checks env vars first, falls back to `.env`.
5. **Supabase-specific migration errors are non-fatal** — Migrations referencing Supabase roles (`anon`, `supabase_realtime_replication_role`) or publications (`supabase_realtime`) fail harmlessly on local Postgres. The core schema applies correctly.
6. **Supabase projects permanently deleted** — Both test and production Supabase instances were deleted (March 2026). No data recovery possible. This simplifies migration: no compatibility layer needed, go direct to target architecture.

---

## Session Log

| Date | Session | Work Done |
|------|---------|-----------|
| 2026-03-04 | Initial planning | Created migration plan, analyzed SQL logic inventory |
| 2026-03-05 | Phase 0 assessment | Checked Supabase connectivity (blocked by sandbox), verified live site loads, confirmed all tests need .env credentials, installed dependencies |
| 2026-03-18 | Plan revision | Supabase permanently deleted — revised plan to skip Phase 0, remove PostgREST compatibility layer, go direct to Python API |
| 2026-03-18 | Droplet setup | DO droplet provisioned (157.245.129.162), remote execution API running, `scripts/remote.sh` created, credentials stored in `.env`, CLAUDE.md updated with droplet management docs |
| 2026-03-18 | Phase 1 complete | Docker installed, `docker-compose.yml` created (Postgres 16 + FastAPI), repo cloned to droplet, all 74 migrations applied, Caddy configured to proxy `whoeverwants.com` → FastAPI, health check verified |
| 2026-03-19 | Phase 2A start | Yes/No vote counting algorithm ported to Python (`server/algorithms/yes_no.py`, 12 tests passing). Fixed hatchling build config. Added Python `.gitignore` entries. |
| 2026-03-19 | Plan revision | Restructured plan from horizontal layers (all algorithms → all API → all frontend) to **vertical slices** per poll type. Each feature gets algorithm + API + frontend done together so it can be tested end-to-end before moving on. |
| 2026-03-19 | Phase 2A APIs | All 9 API endpoints implemented (`server/routers/polls.py`), with database module, Pydantic models, CORS middleware, and 32 integration tests. Deployed to droplet and verified all endpoints working. Fixed missing `short_id` column (migration 021 had failed silently). |
| 2026-03-19 | Phase 2A Frontend | Created `lib/api.ts` fetch-based API client. Replaced ALL supabase calls in critical paths: `PollPageClient.tsx`, `create-poll/page.tsx`, `simplePollQueries.ts`, `VoterList.tsx`, `PollResults.tsx`, `FollowUpHeader.tsx`, `ForkHeader.tsx`, `CompactRankedChoiceResults.tsx`, `p/page.tsx`. Added Next.js rewrite proxy for dev. Real-time subscriptions replaced with polling. |

---

## Quick Reference: SQL Logic Details

### Ranked Choice (IRV) Algorithm
- Runs only on poll close (mutating — writes to `ranked_choice_rounds` table)
- Eliminates last-place candidate each round
- Borda count tiebreaker when multiple candidates tied for last
- Alphabetical tiebreaker if Borda scores also tied
- Exhausted ballots excluded from majority threshold
- Safety limit: 50 rounds

### Participation Priority Algorithm
- Runs live on every results fetch (read-only)
- Priority: no max constraint > higher max > lower min > earlier timestamp
- Greedy selection: iterate voters in priority order, include if constraints satisfied
- Recursive CTE implementation with 100-iteration safety limit

### Vote Structure Rules
- `yes_no`: requires `yes_no_choice`, forbids `ranked_choices`/`nominations`
- `participation`: same structure as `yes_no`
- `ranked_choice`: requires `ranked_choices` array, forbids others
- `nomination`: requires non-empty `nominations` array, forbids others
- All types: `is_abstain=true` relaxes requirements

### Auto-Close Trigger
- Fires on vote INSERT/UPDATE
- For participation polls with `max_participants` set
- Closes poll when `yes` vote count >= `max_participants`
- Uses raw count, not priority-filtered count
