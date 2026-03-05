# WhoeverWants: Server Migration Plan

> This document tracks the incremental migration from a Supabase-only architecture to a Python server + Postgres backend. It is automatically discovered by Claude sessions via the project root.

**Status**: Planning
**Last updated**: 2026-03-04
**Current phase**: Phase 0

---

## Architecture Overview

### Current (Supabase-only)
```
Browser (Next.js) ──► @supabase/supabase-js ──► Supabase Cloud
                                                  ├── PostgREST (REST API)
                                                  ├── PostgreSQL
                                                  │   ├── poll_results VIEW
                                                  │   ├── calculate_ranked_choice_winner()
                                                  │   ├── calculate_participating_voters()
                                                  │   ├── auto_close trigger
                                                  │   └── vote structure constraints
                                                  └── RLS policies
```

### Intermediate (local Postgres + PostgREST, no code changes)
```
Browser (Next.js) ──► @supabase/supabase-js ──► Our Server (Docker)
                      (unchanged!)                ├── PostgREST (drop-in Supabase API)
                                                  ├── PostgreSQL (local)
                                                  │   └── same schema, views, functions
                                                  └── JWT auth (anon role)
```

### Target (Python server replaces PostgREST)
```
Browser (Next.js) ──► Python API (FastAPI) ──► PostgreSQL (local)
                      ├── Poll result calculations     (data storage only,
                      ├── IRV/ranked choice algorithm    no business logic
                      ├── Participation priority          in SQL)
                      ├── Vote validation
                      └── Auto-close logic
```

### Frontend Supabase Usage (only 2 files)
The `@supabase/supabase-js` client is used in exactly 2 files:
- **`lib/supabase.ts`** — all CRUD + 2 RPC calls (`calculate_ranked_choice_winner`, `calculate_participating_voters`)
- **`app/api/polls/discover-related/route.ts`** — 1 RPC call (`get_all_related_poll_ids`)

The client talks to PostgREST (REST over Postgres), not raw Postgres. So swapping Supabase Cloud for local PostgREST + Postgres requires **zero frontend code changes** — just new env vars.

---

## Phases

### Phase 0: Restore & Baseline
**Goal**: Get the existing app working again after Supabase hibernation.

- [ ] Wake up Supabase free-tier instances (test + production)
- [ ] Verify the app loads and basic operations work (create poll, vote, view results)
- [ ] Run unit tests to confirm baseline: `npm run test:run`
- [ ] Document any issues found

### Phase 1: Server Infrastructure
**Goal**: Stand up a cheap cloud server with Docker, Postgres, PostgREST, and git-based deployment.

- [ ] **Choose hosting**: Cheapest option for a low-traffic Docker setup with persistent state (candidates: Hetzner VPS ~$4/mo, Oracle Cloud free tier, DigitalOcean $4/mo droplet, Railway/Render free tier)
- [ ] **User action required**: Sign up for hosting provider and provide credentials/API keys to Claude
- [ ] **Provision server**: Docker Compose setup with:
  - **PostgreSQL** (local instance)
  - **PostgREST** (provides the same REST API that `@supabase/supabase-js` expects)
  - **JWT secret** for anon role auth (so supabase-js client works unchanged)
  - Reverse proxy (Caddy) for HTTPS + routing
  - Python service placeholder (FastAPI, wired up but no logic yet)
- [ ] **Git-based deployment**: Set up auto-pull from GitHub on the server, or a webhook that triggers redeploy
- [ ] **Store credentials**: All server access credentials stored in dev environment for Claude
- [ ] **Verify**: Server is reachable, PostgREST responds to health check

### Phase 2: Point Frontend at Local Postgres (Zero Code Changes)
**Goal**: Migrate the database and switch the frontend from Supabase Cloud to our server's PostgREST + Postgres — with no frontend code changes.

#### Why this works with zero code changes:
`@supabase/supabase-js` is just a REST client that talks to PostgREST. It needs:
1. A URL (the PostgREST endpoint)
2. An anon key (a JWT with `role: anon`)

By running PostgREST locally with the same schema, views, functions, and RLS policies, the existing frontend code works identically.

#### Steps:
- [ ] **Apply all 63 migrations** to local Postgres (reuse existing `database/migrations/` files)
- [ ] **Replicate stored functions**: `calculate_ranked_choice_winner()`, `calculate_participating_voters()`, `get_all_related_poll_ids()`, `calculate_valid_participation_votes()`
- [ ] **Replicate RLS policies**: Same row-level security as Supabase
- [ ] **Replicate the `poll_results` view** and all triggers
- [ ] **Configure JWT auth**: Generate anon key JWT matching PostgREST's expected format
- [ ] **Seed data**: Export existing polls/votes from Supabase, import to local Postgres
- [ ] **Update env vars**: Set `NEXT_PUBLIC_SUPABASE_URL_TEST` to point at our PostgREST, update anon key
- [ ] **Verify end-to-end**: Create poll, vote, view results, close poll — all working against local DB
- [ ] **Keep Supabase as fallback**: Can revert env vars to restore Supabase connectivity instantly

### Phase 3: Replicate Core Algorithms in Python
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

### Phase 4: API Layer
**Goal**: Expose Python calculations via HTTP API that the Next.js frontend can call.

- [ ] Design API endpoints:
  - `GET /api/polls/{id}/results` — compute and return poll results
  - `POST /api/polls/{id}/close` — close poll + run ranked choice calculation
  - `GET /api/polls/{id}/participants` — participation priority calculation
  - `POST /api/votes` — validate + submit vote (with structure validation)
  - `GET /api/polls/{id}/related` — related poll discovery
- [ ] API reads/writes to local Postgres
- [ ] Add API integration tests

### Phase 5: Incremental Frontend Migration
**Goal**: Switch the Next.js frontend from `@supabase/supabase-js` + PostgREST to calling the Python API directly.

This is where we replace the supabase-js client. Only 2 files need changes:
- `lib/supabase.ts` (all CRUD + 2 RPCs)
- `app/api/polls/discover-related/route.ts` (1 RPC)

Migration order (least risk first):
1. [ ] Poll results calculation (read-only, easy to verify)
2. [ ] Related poll discovery (read-only)
3. [ ] Vote validation (can run in parallel with DB constraints initially)
4. [ ] Ranked choice winner calculation (triggered on poll close)
5. [ ] Participation priority algorithm
6. [ ] Vote submission (write path — highest risk)
7. [ ] Poll creation

At each step:
- [ ] Deploy change to frontend
- [ ] Verify functionality manually
- [ ] Compare results with PostgREST-computed values (still available as fallback)

### Phase 6: Cleanup & Decommission
**Goal**: Remove Supabase dependencies entirely.

- [ ] Remove `@supabase/supabase-js` from package.json
- [ ] Remove PostgREST container (no longer needed once Python API handles everything)
- [ ] Remove SQL stored procedures (logic now lives in Python)
- [ ] Simplify DB to pure data storage (tables + indexes, no views/functions/triggers)
- [ ] Remove Supabase env vars and migration scripts
- [ ] Decommission Supabase free-tier instances

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

1. **No `.env` file in repo** — All Supabase credentials must be provided out-of-band. Tests are integration tests that require real Supabase connectivity; there are no mocked/offline unit tests.
2. **Container egress restrictions** — Claude Code's sandboxed environment blocks outbound connections to `supabase.co` (DNS blocked by egress proxy). Supabase connectivity checks and integration tests must be run locally or in CI.
3. **All tests are integration tests** — Every test suite in `tests/` talks to the real Supabase database. There are no pure unit tests that can run offline. This is worth addressing in Phase 3 when algorithms move to Python.

---

## Session Log

| Date | Session | Work Done |
|------|---------|-----------|
| 2026-03-04 | Initial planning | Created migration plan, analyzed SQL logic inventory |
| 2026-03-05 | Phase 0 assessment | Checked Supabase connectivity (blocked by sandbox), verified live site loads, confirmed all tests need .env credentials, installed dependencies |

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
