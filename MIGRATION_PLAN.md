# WhoeverWants: Server Migration Plan

> This document tracks the incremental migration from a Supabase-only architecture to a Python server + Postgres backend. It is automatically discovered by Claude sessions via the project root.

**Status**: Planning
**Last updated**: 2026-03-04
**Current phase**: Phase 0

---

## Architecture Overview

### Current (Supabase-only)
```
Browser (Next.js) <---> Supabase (PostgreSQL + PostgREST API)
                        - poll_results VIEW
                        - calculate_ranked_choice_winner() stored proc
                        - calculate_participating_voters() stored proc
                        - auto_close trigger
                        - vote structure constraints
```

### Target (Python server + Postgres)
```
Browser (Next.js) <---> Python API Server <---> PostgreSQL
                        - Poll result calculations
                        - IRV/ranked choice algorithm
                        - Participation priority algorithm
                        - Vote validation
                        - Auto-close logic
```

---

## Phases

### Phase 0: Restore & Baseline
**Goal**: Get the existing app working again after Supabase hibernation.

- [ ] Wake up Supabase free-tier instances (test + production)
- [ ] Verify the app loads and basic operations work (create poll, vote, view results)
- [ ] Run unit tests to confirm baseline: `npm run test:run`
- [ ] Document any issues found

### Phase 1: Server Infrastructure
**Goal**: Stand up a cheap cloud server with Python, Postgres, and git-based deployment.

- [ ] **Choose hosting**: Cheapest option for a low-traffic Docker container with persistent state (candidates: Hetzner VPS ~$4/mo, Oracle Cloud free tier, DigitalOcean $4/mo droplet, Railway/Render free tier)
- [ ] **User action required**: Sign up and provide credentials/API keys to Claude
- [ ] **Provision server**: Docker + Docker Compose setup with:
  - Python API service (FastAPI or Flask)
  - PostgreSQL instance (local to the server)
  - Reverse proxy (Caddy or nginx) if needed
- [ ] **Git-based deployment**: Set up auto-pull from GitHub on the server, or a webhook that triggers redeploy
- [ ] **Store credentials**: All server access credentials stored in dev environment for Claude
- [ ] **Verify**: Server is reachable, Python service responds to health check

### Phase 2: Replicate Core Algorithms in Python
**Goal**: Port all SQL business logic to Python, with tests proving equivalence.

#### SQL logic to migrate (by complexity):

| Component | SQL Location | Complexity | Strategy |
|-----------|-------------|------------|----------|
| Yes/No vote counting | `poll_results` view | Low | Simple aggregation |
| Nomination vote counting | Already in TypeScript | Low | Port to Python |
| `update_updated_at` trigger | Migration 001 | Low | Set in app layer |
| `get_all_related_poll_ids()` | Migration 017 | Low | Recursive tree walk |
| `calculate_valid_participation_votes()` | Migration 061 | Low | Wrapper function |
| Vote structure validation | Migration 053 constraints | Medium | Python validation |
| `auto_close_participation_poll()` trigger | Migration 056 | Medium | Server-side webhook/polling |
| `poll_results` view (full) | Migration 058 | Medium | Python computation |
| `calculate_ranked_choice_winner()` | Migration 046 | **High** | IRV + Borda tiebreak |
| `calculate_participating_voters()` | Migration 063 | **High** | Recursive greedy priority |

#### Approach:
- [ ] Port each algorithm to Python with comprehensive unit tests
- [ ] Test against known inputs/outputs from the existing Vitest test suite
- [ ] Ranked choice: Port IRV with Borda tiebreaker, validate against `tests/__tests__/ranked-choice/` and `tests/__tests__/voting-algorithms/`
- [ ] Participation: Port priority-based greedy selection algorithm
- [ ] Each algorithm gets its own Python module + test file

### Phase 3: API Layer
**Goal**: Expose Python calculations via HTTP API that the Next.js frontend can call.

- [ ] Design API endpoints:
  - `GET /api/polls/{id}/results` — compute and return poll results
  - `POST /api/polls/{id}/close` — close poll + run ranked choice calculation
  - `GET /api/polls/{id}/participants` — participation priority calculation
  - `POST /api/votes` — validate + submit vote (with structure validation)
  - `GET /api/polls/{id}/related` — related poll discovery
- [ ] API reads/writes to local Postgres (initially synced from Supabase, later as primary)
- [ ] Add API integration tests

### Phase 4: Incremental Frontend Migration
**Goal**: Switch the Next.js frontend to call the Python API instead of Supabase, one feature at a time.

Migration order (least risk first):
1. [ ] Poll results calculation (read-only, easy to verify)
2. [ ] Related poll discovery (read-only)
3. [ ] Vote validation (can run in parallel with DB constraints initially)
4. [ ] Ranked choice winner calculation (triggered on poll close)
5. [ ] Participation priority algorithm
6. [ ] Vote submission (write path — highest risk)
7. [ ] Poll creation

At each step:
- [ ] Deploy change
- [ ] Verify functionality manually
- [ ] Compare results with Supabase-computed values
- [ ] Keep Supabase as fallback until confident

### Phase 5: Data Migration
**Goal**: Move from Supabase as primary database to local Postgres.

- [ ] Set up data sync from Supabase to local Postgres
- [ ] Migrate writes to go through Python server -> local Postgres
- [ ] Keep Supabase as read replica/backup during transition
- [ ] Eventually decommission Supabase dependency

---

## Decisions & Constraints

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server language | Python | Avoid compile times, AI-friendly, rapid iteration |
| Web framework | TBD (FastAPI likely) | Async, good typing, auto-docs |
| Hosting | TBD | Cheapest option with persistent state |
| Database | PostgreSQL (local) | Same dialect as Supabase, easy migration |
| Deployment | Git-based auto-deploy | Claude manages everything remotely |
| Development flow | Claude Code iOS app | No manual SSH — Claude has full control |

---

## Lessons Learned

> Record important discoveries and gotchas here across sessions.

*(None yet — will be populated as work progresses)*

---

## Session Log

| Date | Session | Work Done |
|------|---------|-----------|
| 2026-03-04 | Initial planning | Created migration plan, analyzed SQL logic inventory |

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
