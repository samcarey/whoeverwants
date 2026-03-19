# WhoeverWants: Server Migration Plan

> This document tracks the migration from a Supabase-only architecture to a Python server + Postgres backend. It is automatically discovered by Claude sessions via the project root.

**Status**: Active — Phase 2D complete
**Last updated**: 2026-03-19
**Current phase**: Phase 2E next (Shared features)

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
17. [x] **Deploy to droplet** — Python API in Docker, Next.js as systemd service (standalone build). Caddy routes `/api/polls` to Python, everything else to Next.js.
18. [x] **End-to-end test** — Created yes/no poll via API, submitted 3 votes, verified results (67% yes, 33% no, winner: "yes"). Frontend serves poll page at `/p/{short_id}/`.
19. [x] **DNS cutover** — A record updated to `157.245.129.162`. Caddy auto-provisioned Let's Encrypt TLS cert. Site live at `https://whoeverwants.com`.

---

### Phase 2B: Nomination Polls ✓ COMPLETE
**Goal**: Get nomination polls fully working through the Python API.

1. [x] **Nomination vote counting algorithm** — `server/algorithms/nomination.py` + 16 tests. Counts nominations across all non-abstaining voters, includes poll options with 0 votes, sorts by count desc then alphabetical.
2. [x] **Vote structure validation** — `server/algorithms/vote_validation.py` + 28 tests. Enforces required/forbidden fields per poll type (yes_no, nomination, ranked_choice, participation). Rejects malformed votes before DB insert.
3. [x] **Extend API endpoints** — Results endpoint returns `nomination_counts` array. Vote submission validates structure against poll type.
4. [x] **Frontend swap** — `PollResults.tsx` uses server-side `nomination_counts` instead of client-side aggregation. `NominationVotingInterface.tsx` reads from `pollResults.nomination_counts`.
5. [x] **Deploy & test** — Created nomination poll with 3 starting options, submitted 3 votes (2 nominations + 1 abstain), verified correct counts via API. Vote validation rejects wrong vote types and empty nominations.

---

### Phase 2C: Ranked Choice Polls
**Goal**: Get ranked choice (IRV) polls fully working through the Python API.

1. [x] **IRV algorithm** — `server/algorithms/ranked_choice.py` + 27 tests. IRV with Borda tiebreak + exhausted ballot handling. Ported from SQL migration 046. Covers: immediate winners, sequential elimination, vote transfer, Borda tie-breaking, incomplete ballots, edge cases.
2. [x] **Extend API** — Results endpoint computes ranked choice rounds server-side and returns `ranked_choice_rounds` + `ranked_choice_winner` in `PollResultsResponse`. Added `RankedChoiceRoundResponse` model with Borda score data.
3. [x] **Frontend swap** — `CompactRankedChoiceResults.tsx` reads rounds from API results object instead of `getRankedChoiceRounds()` (Supabase). `BordaCountExplanation` uses embedded Borda scores. Removed dead `RankedChoiceResults` function from `PollResults.tsx`.
4. [x] **Deploy & test** — Deployed to droplet. Created ranked choice poll, submitted 3 votes (3-way tie), verified IRV rounds: Charlie eliminated by alphabetical tiebreak, Alice wins with 2/3 majority in round 2. Also verified immediate majority win (3/5 in round 1). Frontend serves at `https://whoeverwants.com/p/{short_id}/`.

---

### Phase 2D: Participation Polls ✓ COMPLETE
**Goal**: Get participation polls fully working through the Python API.

1. [x] **Participation priority algorithm** — `server/algorithms/participation.py` already existed with full greedy priority-based voter selection (ported from migration 063).
2. [x] **Extend API: results** — `get_results()` now handles `participation` poll type explicitly: counts yes/no/abstain votes, runs priority algorithm, returns `yes_count` = number of valid participants. Previously fell through to catch-all returning `yes_count=None`.
3. [x] **Extend API: participants endpoint** — `GET /api/polls/{id}/participants` returns list of `{vote_id, voter_name}` for voters selected by the priority algorithm.
4. [x] **Frontend: fetch participants** — `PollResults.tsx` calls `apiGetParticipants()` instead of the TODO stub that always set `participants=[]`. `lib/api.ts` has new `apiGetParticipants()` function.
5. [x] **`auto_close_participation_poll()` trigger** — `server/algorithms/auto_close.py` + 11 tests. `should_auto_close()` checks if yes votes >= max_participants. Integrated into both vote submission and edit endpoints via `_check_auto_close()` helper in `server/routers/polls.py`.
6. [x] **Deploy & test with conditions** — All scenarios verified E2E on droplet:
   - Basic: 3 yes voters with compatible conditions → all 3 selected as participants
   - Conflicting: Alice (max=1), Bob (no max), Charlie (max=3) → priority algorithm correctly excludes Alice (too restrictive), selects Bob + Charlie
   - Unsatisfiable: 2 voters each wanting exactly 5 → `yes_count=0`, empty participants
   - All-abstain/no: 2 abstains + 1 no → `yes_count=0`, correct counts
   - Auto-close: poll with `max_participants=3` auto-closed after 3 yes votes (`close_reason="max_capacity"`), 4th vote rejected
7. [x] **Edge cases** — All edge cases verified: conflicting constraints, unsatisfiable conditions, all-abstain, auto-close trigger.

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
7. **Catch-all fallthrough bugs in `get_results()`** — When adding new poll types, the `get_results()` endpoint in `server/routers/polls.py` has a catch-all return at the bottom that returns `yes_count=None`. Any poll type without an explicit handler silently falls through, and the frontend interprets `None` as `0`. Always add an explicit handler for each poll type.
8. **Frontend TODO stubs cause silent failures** — `PollResults.tsx` had a `setParticipants([])` TODO stub. The frontend logic branched on `participants` being empty vs populated, so the stub caused incorrect UI ("You're not participating but these are" with empty list) without any errors. When adding backend endpoints, always check if the frontend has TODO stubs that need to be connected.
9. **Next.js restart on droplet** — The Next.js server runs as a bare `next-server` process (not pm2 or systemd). After `npm run build`, restart by killing the old process and running `NODE_ENV=production npx next start -p 3000` in the background. Verify with `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000`.

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
| 2026-03-19 | Phase 2A Deploy | Deployed full stack to droplet: Python API in Docker, Next.js as systemd service (standalone build avoids OOM on 1GB). Added 2GB swap, installed Node.js 20. Caddy routes `/api/polls/*` to Python API, everything else to Next.js. Fixed TypeScript build errors, FastAPI redirect_slashes issue. E2E test: created poll, voted, verified results. DNS still points to Vercel — needs A record update to 157.245.129.162. |
| 2026-03-19 | Phase 2B complete | Nomination polls: algorithm (16 tests), vote validation for all types (28 tests), server-side results with `nomination_counts`, frontend uses server data instead of client-side aggregation. Deployed and verified E2E: created nomination poll, 3 votes, correct counts. |
| 2026-03-19 | Phase 2C complete | Ranked choice IRV algorithm (27 tests), API returns `ranked_choice_rounds` + `ranked_choice_winner` in results. Frontend reads rounds from API instead of Supabase `getRankedChoiceRounds()`. Borda tiebreak data embedded in round entries. Deployed and verified E2E on whoeverwants.com. |
| 2026-03-19 | Phase 2D start | Fixed participation poll results: added explicit `participation` handler in `get_results()` (was falling through to catch-all returning `yes_count=None`). Added `GET /api/polls/{id}/participants` endpoint using existing `calculate_participating_voters()` algorithm. Connected frontend `PollResults.tsx` to call `apiGetParticipants()` instead of TODO stub. Basic single-voter participation poll now works E2E. Remaining: auto-close trigger, multi-voter conditional testing. |
| 2026-03-19 | Phase 2D complete | Deployed auto-close logic to droplet. Comprehensive E2E testing of all participation poll scenarios: basic 3-voter compatible constraints (all selected), conflicting constraints with priority algorithm (Bob+Charlie selected, Alice excluded for max=1), unsatisfiable conditions (yes_count=0), all-abstain (correct counts), auto-close trigger (poll closes at max_capacity, rejects subsequent votes). All 4 poll types now fully working through Python API. |

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
