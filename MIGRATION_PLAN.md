# WhoeverWants: Server Migration Plan

> This document tracks the migration from a Supabase-only architecture to a Python server + Postgres backend. It is automatically discovered by Claude sessions via the project root.

**Status**: Active — Phase 1
**Last updated**: 2026-03-18
**Current phase**: Phase 1 (Server Infrastructure)

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

### Phase 1: Server Infrastructure ← CURRENT
**Goal**: Stand up a cheap cloud server with Docker, Postgres, and Python API.

- [ ] **Choose hosting**: Cheapest option for a low-traffic Docker setup with persistent state (candidates: Hetzner VPS ~$4/mo, Oracle Cloud free tier, DigitalOcean $4/mo droplet, Railway/Render free tier)
- [ ] **User action required**: Sign up for hosting provider and provide credentials/API keys to Claude
- [ ] **Provision server**: Docker Compose setup with:
  - **PostgreSQL** (local instance)
  - **Python API** (FastAPI)
  - Reverse proxy (Caddy) for HTTPS + routing
- [ ] **Apply database schema**: Run all 63 migrations against local Postgres
- [ ] **Git-based deployment**: Set up auto-pull from GitHub on the server, or a webhook that triggers redeploy
- [ ] **Store credentials**: All server access credentials stored in dev environment for Claude
- [ ] **Verify**: Server is reachable, API responds to health check

### Phase 2: Port Core Algorithms to Python
**Goal**: Implement all SQL business logic in Python, with tests proving correctness.

#### SQL logic to port (by complexity):

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
  - `POST /api/polls` — create poll
  - `POST /api/polls/{id}/close` — close poll + run ranked choice calculation
  - `GET /api/polls/{id}/participants` — participation priority calculation
  - `POST /api/votes` — validate + submit vote (with structure validation)
  - `GET /api/polls/{id}/related` — related poll discovery
  - CRUD for all poll/vote operations currently done via supabase-js
- [ ] API reads/writes to local Postgres
- [ ] Add API integration tests

### Phase 4: Frontend Migration
**Goal**: Replace `@supabase/supabase-js` with direct calls to our Python API.

Only 2 files need changes:
- `lib/supabase.ts` (all CRUD + 2 RPCs)
- `app/api/polls/discover-related/route.ts` (1 RPC)

Migration order (least risk first):
1. [ ] Poll results calculation (read-only, easy to verify)
2. [ ] Related poll discovery (read-only)
3. [ ] Vote validation
4. [ ] Ranked choice winner calculation (triggered on poll close)
5. [ ] Participation priority algorithm
6. [ ] Vote submission (write path)
7. [ ] Poll creation

### Phase 5: Cleanup
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
| Web framework | TBD (FastAPI likely) | Async, good typing, auto-docs |
| Hosting | TBD | Cheapest option with persistent state |
| Database | PostgreSQL (local) | Same dialect as Supabase, easy migration |
| Deployment | Git-based auto-deploy | Claude manages everything remotely |
| Development flow | Claude Code iOS app | No manual SSH — Claude has full control |
| Supabase fallback | None | Both projects permanently deleted |

---

## Lessons Learned

> Record important discoveries and gotchas here across sessions.

1. **No `.env` file in repo** — All Supabase credentials must be provided out-of-band. Tests are integration tests that require real Supabase connectivity; there are no mocked/offline unit tests.
2. **Container egress restrictions** — Claude Code's sandboxed environment blocks outbound connections to `supabase.co` (DNS blocked by egress proxy). Supabase connectivity checks and integration tests must be run locally or in CI.
3. **All tests are integration tests** — Every test suite in `tests/` talks to the real Supabase database. There are no pure unit tests that can run offline. Must be rewritten in Phase 5.
4. **Supabase projects permanently deleted** — Both test and production Supabase instances were deleted (March 2026). No data recovery possible. This simplifies migration: no compatibility layer needed, go direct to target architecture.

---

## Session Log

| Date | Session | Work Done |
|------|---------|-----------|
| 2026-03-04 | Initial planning | Created migration plan, analyzed SQL logic inventory |
| 2026-03-05 | Phase 0 assessment | Checked Supabase connectivity (blocked by sandbox), verified live site loads, confirmed all tests need .env credentials, installed dependencies |
| 2026-03-18 | Plan revision | Supabase permanently deleted — revised plan to skip Phase 0, remove PostgREST compatibility layer, go direct to Python API |

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
