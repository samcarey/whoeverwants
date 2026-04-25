# Multipoll Redesign — Phasing Plan

This document breaks the multipoll redesign (see CLAUDE.md → "Multipoll System (In Progress)") into discrete, shippable phases. Phase 1 is fully specified here; later phases are sketched and will be refined when their turn comes.

The guiding principle: **every phase leaves `main` shippable**. Existing polls keep working through every step. The destructive cutover (migrating existing polls into multipoll wrappers) happens late, only after the new code paths have been exercised on freshly-created multipolls in production.

---

## Schema strategy (applies across phases)

Rather than introduce a new `sub_polls` table that duplicates `polls`, we treat the existing `polls` table as **the sub-poll table** and add a new `multipolls` table for the wrapper-level fields. Each row in `polls` gains an `multipoll_id` FK pointing to its wrapper. A wrapper with one sub-poll renders identically to today's single-poll view (the wrapper is invisible).

### Wrapper-level fields (move to `multipolls`)

These currently live on `polls` and apply to the whole multipoll, not any one sub-poll:

| Column | Notes |
|---|---|
| `id` (uuid, pk) | New uuid. Not the same as any poll id. |
| `short_id` (text, unique) | Moves off `polls`. URL targets the multipoll, not a sub-poll. |
| `creator_secret` (uuid) | One secret for the whole multipoll. |
| `creator_name` (text, nullable) | |
| `response_deadline` (timestamptz) | The voting cutoff. |
| `prephase_deadline` (timestamptz, nullable) | Shared suggestion/availability cutoff. |
| `prephase_deadline_minutes` (int, nullable) | For deferred prephase timing (mirrors current `suggestion_deadline_minutes`). |
| `is_closed` (bool) | |
| `close_reason` (text, nullable) | `'manual' \| 'deadline' \| 'max_capacity' \| 'uncontested'`. |
| `follow_up_to` (uuid → multipolls.id, nullable) | Threads = chains of multipolls. |
| `fork_of` (uuid → multipolls.id, nullable) | |
| `thread_title` (text, nullable) | User override; inherited from `follow_up_to`'s `thread_title` via the same `COALESCE` insert pattern as today. |
| `context` (text, nullable) | Optional whole-multipoll context (replaces today's `details` for the wrapper level). |
| `created_at` / `updated_at` | |

### Sub-poll-level fields (stay on `polls`)

These are per-sub-poll and never need to be lifted to the wrapper:

| Column | Notes |
|---|---|
| `id`, `poll_type`, `category`, `options`, `options_metadata` | |
| `details` | Per-sub-poll context label (e.g. disambiguating two `Where` sub-polls). |
| `multipoll_id` (uuid → multipolls.id) | New, NOT NULL after Phase 4. Nullable during the dual-mode phases so legacy single polls still work. |
| `sub_poll_index` (int) | Display order within the multipoll. |
| Type-specific fields | `suggestion_deadline_minutes`, `min_availability_percent`, time-poll fields, etc. The `suggestion_deadline` *value* moves to the multipoll level (shared); the *minutes* stay per-sub-poll only because different sub-poll types may compute it differently — but in practice all prephase-bearing sub-polls in a multipoll resolve to the same cutoff. **TBD in Phase 3:** whether `*_minutes` consolidates onto the multipoll. |

### Fields that get retired (later)

By Phase 5, the following can be dropped from `polls` because the multipoll owns them:
`short_id`, `creator_secret`, `creator_name`, `response_deadline`, `is_closed`, `close_reason`, `follow_up_to`, `fork_of`, `thread_title`, `suggestion_deadline`. Don't drop them earlier — old code paths still read them.

### Why participation polls are excluded

Per CLAUDE.md → "Participation Polls (Deprecated)", participation polls don't get wrapped. They keep their own row in `polls` with `multipoll_id = NULL` forever. Phase 4's backfill explicitly skips `poll_type = 'participation'`.

---

## Phase 1 — Foundation (this phase)

**Goal**: stand up the `multipolls` table and the new API endpoints. No frontend changes. No migration of existing data. Existing single-poll codepaths are untouched. The new API works end-to-end so Phase 2 can build a UI against it.

### What's in scope

1. **One up/down migration** (next number `092`):
   - Create `multipolls` table with the columns above. All wrapper-level fields are NULLABLE except `id`, `short_id`, `creator_secret`, `created_at`, `updated_at` to allow flexible test-data shapes. RLS policies match those on `polls` (anon read, anon write; row-level access via `creator_secret` for mutations).
   - Add `multipoll_id` (uuid, nullable, FK → multipolls.id ON DELETE CASCADE) and `sub_poll_index` (int, nullable) to `polls`. Both nullable in Phase 1 — existing polls have NULL.
   - Backfill is **out of scope** for this migration. Existing polls keep `multipoll_id IS NULL`.
   - Down migration: drop the FK and the new columns from `polls`, drop `multipolls`. Pure additive — fully reversible.
2. **Pydantic models** (`server/models.py`):
   - `CreateMultipollRequest` — wrapper fields + `sub_polls: list[CreateSubPollRequest]` (1+).
   - `CreateSubPollRequest` — every per-sub-poll field from the existing `CreatePollRequest` *except* the wrapper-level ones, plus optional per-sub-poll `context`.
   - `MultipollResponse` — wrapper fields + `sub_polls: list[PollResponse]`.
3. **Endpoints** (`server/routers/polls.py` or a new `server/routers/multipolls.py`):
   - `POST /api/multipolls` — creates one multipoll row + N poll rows in a single transaction. Returns the `MultipollResponse` plus the existing per-sub-poll `PollResponse` shape so the frontend can keep using the existing read paths.
   - `GET /api/multipolls/{short_id}` — returns the multipoll wrapper + sub-polls, ordered by `sub_poll_index`.
   - `GET /api/multipolls/by-id/{multipoll_id}` — same as above by uuid.
   - **Auto-title**: `POST /api/multipolls` accepts an optional `title` and, when absent, computes one from `(sub_poll.category for sub_poll in sub_polls)` joined in title case (algorithm: see "Auto-title rules" below). Persisted to `multipolls.thread_title` only when explicitly provided; otherwise re-computed at read time so re-arranging sub-polls re-titles for free. **No new `multipolls.title` column.** The thread card already auto-titles from participants + thread_title; multipolls extend that with category-based titles.
   - **Validation**:
     - At least 1 sub-poll.
     - At most one sub-poll of `poll_type = 'time'` (a single shared availability phase has only one time sub-poll).
     - Multiple sub-polls of the same kind require distinct `context` strings.
     - **Reject** `poll_type = 'participation'` sub-polls — multipoll system excludes them.
     - `prephase_deadline < response_deadline` when both are set.
4. **Tests** (`server/tests/`):
   - Unit: title generator, sub-poll validators, transaction rollback on bad sub-poll input.
   - Integration: create single-sub-poll multipoll → `GET` returns it; create 3-sub-poll multipoll (e.g. one What, one When, one Where) → `GET` returns all 3 in order; create-with-bad-input rolls back atomically (no orphan polls).
   - **No coverage of voting, results, or thread aggregation in Phase 1.** Each sub-poll inherits the existing single-poll vote/results endpoints unchanged.
5. **No frontend changes.** `lib/api.ts` may add `apiCreateMultipoll` / `apiGetMultipoll` helpers if convenient, but no component or page uses them yet.

### Auto-title rules

Pure function `generate_multipoll_title(sub_polls, multipoll_context) -> str`. Lives in `server/algorithms/multipoll_title.py` so it can be unit-tested.

- Input: ordered list of sub-poll category strings (e.g. `["restaurant", "time"]`) + optional multipoll-level context (e.g. `"Birthday"`).
- Output rules (deterministic, locked here so frontend Phase 2 can mirror them):
  - 1 sub-poll, no context → use the sub-poll's existing single-poll auto-title (`"Restaurant?"`, `"Time?"`, etc.).
  - 1 sub-poll + context → `"<Category> for <Context>"` (e.g. `"Restaurant for Birthday"`).
  - 2+ sub-polls, no context → `"<A> and <B>"` (2) or `"<A>, <B>, and <C>"` (3+), title-cased.
  - 2+ sub-polls + context → above + ` for <Context>` (e.g. `"Restaurant and Time for Birthday"`).
- Categories are mapped to titlecase display labels via the same lookup the frontend already uses (TBD: extract `BUILT_IN_TYPES` labels from `components/TypeFieldInput.tsx` into a backend-shared JSON or duplicate). For Phase 1, hardcode the eight common labels (`yes/no`, `restaurant`, `location`, `time`, `movie`, `videogame`, `petname`, `custom`) and fall back to title-cased `category` string for unknowns.

### Out of scope for Phase 1

- Frontend What/When/Where buttons.
- Dual-modal create flow.
- Multi-sub-poll voting (single Submit, per-sub-poll abstain).
- Thread card aggregation (one card per multipoll instead of per poll).
- Migration of existing polls.
- Moving `follow_up_to` / `fork_of` to multipolls.
- Any change to how votes, results, close/reopen, or threading work for legacy single polls.

### Risk / rollback

- All schema changes are additive. The down migration cleanly removes them.
- New endpoints are net-new; no existing route changes behavior.
- The whole phase can be reverted by `git revert` + running the down migration.

### Done criteria

- Migration `092` applied on dev + production droplets.
- `POST /api/multipolls` + `GET /api/multipolls/{short_id}` + `GET /api/multipolls/by-id/{id}` all green in `server/tests/`.
- A `curl` against the dev API can create a 3-sub-poll multipoll and read it back. Demo this in the PR description.
- Existing E2E suite still passes.

---

## Phase 2 — Frontend creation flow

**Goal**: users start creating multipolls via the new What/When/Where bubbles. New polls go through `POST /api/multipolls`. Old polls continue to render via the existing single-poll codepath.

### Scope sketch

- Replace single `+` FAB on home + thread pages with **What / When / Where** bubble buttons (equally spaced along the bottom).
- Each bubble opens the dual-modal sheet (top: sub-poll category + options + per-sub-poll context; bottom: shared multipoll context + voting cutoff + optional prephase cutoff).
- Top modal's checkmark commits the sub-poll into a draft slot. The What/When/Where buttons reappear so the user can add more.
- localStorage draft persistence (per-tab, per-device).
- Submit calls `POST /api/multipolls`; on success, navigate to `/p/<multipoll_short_id>/`.
- **The thread/poll page reads via `GET /api/multipolls/by-id/{...}`** when the multipoll wrapper exists; otherwise falls through to the existing single-poll path. This means voting/results/close/reopen still flow through the per-sub-poll endpoints — Phase 2 doesn't unify those yet.
- 1-sub-poll multipolls render identically to today's polls (the wrapper is invisible).
- Backwards-compat: every existing `+`-button entry point (Follow-Up, Fork, Duplicate, "Vote on it", thread-page FAB) is replaced with the new bubble UI.

### Open questions for Phase 2

- How do Follow-Up / Fork / Duplicate compose with the new What/When/Where flow? Likely: each of those auto-fills a single What sub-poll matching the source poll's category, and the user can add more sub-polls before submitting.
- Does the bottom modal "shared prephase cutoff" only show when at least one of the staged sub-polls has a prephase? (Probably yes — if the only sub-poll is a yes/no, no prephase cutoff is needed.)
- Pre-existing pollCache / accessiblePollsCache invalidation when the new endpoint is the source of truth.

---

## Phase 3 — Voting + multipoll-level operations unified

**Goal**: voting, results, close/reopen, follow-up/fork all operate at the multipoll level.

### Scope sketch

- Single `POST /api/multipolls/{id}/votes` accepts an array of `{sub_poll_id, ...vote payload}` plus a single `voter_name` and per-sub-poll `is_abstain`.
- The thread card displays one card per multipoll. Each sub-poll renders inside the card with its `context` label. There's one Submit at the bottom.
- Compact previews stack one per sub-poll inside the card footer row.
- `multipolls.is_closed` becomes the source of truth for "is this poll open"; existing per-poll `is_closed` continues to be written to keep legacy code working until Phase 5.
- Long-press modal (Forget / Reopen / Close / End Pre-Phase) targets the multipoll, not any single sub-poll.
- Multipoll-level `follow_up_to` and `fork_of` are introduced — the new bubble FAB on a thread page sets them.
- Cache layer updates: `pollCache.ts` adds a `multipollCache` keyed by short_id; getAccessiblePolls returns multipolls.

### Migration concern

By the end of Phase 3, two write paths exist for any given user action:
1. New polls (created in Phase 2+) live as multipolls; voting/closing operates at the multipoll level.
2. Old polls (created before Phase 2) live as standalone `polls` rows with no multipoll wrapper; voting/closing still uses the per-poll endpoints.

The frontend needs to handle both. A simple way: if `poll.multipoll_id` is set, use multipoll-level endpoints; else use legacy endpoints. The thread list and poll page already deal with mixed state via `lib/threadUtils.ts`.

---

## Phase 4 — Backfill existing polls

**Goal**: every non-participation poll has a multipoll wrapper. The legacy single-poll codepath can be deleted.

### Scope sketch

- One-shot data migration (next available migration number, `093` or higher):
  - For every poll with `multipoll_id IS NULL` and `poll_type != 'participation'`:
    - Insert a multipoll row, copying wrapper-level fields from the poll.
    - Set the poll's `multipoll_id` to the new multipoll id, `sub_poll_index = 0`.
    - The multipoll's `short_id` adopts the poll's `short_id`. The poll's `short_id` is left in place but is no longer the URL target.
  - For every poll with `follow_up_to` or `fork_of` set, look up the target poll's new `multipoll_id` and write that into the new multipoll's `follow_up_to` / `fork_of`.
  - Wrap in a single transaction.
- `/p/<shortId>/` route resolves shortId → multipoll first, then falls back to poll for the brief window before the migration runs in production.
- After successful production run, the frontend can drop the legacy fallback path.
- **Participation polls are deliberately untouched.** Their URL routing keeps working via the legacy single-poll path; they remain `multipoll_id IS NULL` forever.

---

## Phase 5 — Cleanup

**Goal**: remove the columns and code paths the multipoll system no longer needs.

### Scope sketch

- Drop wrapper-level columns from `polls`: `short_id`, `creator_secret`, `creator_name`, `response_deadline`, `is_closed`, `close_reason`, `follow_up_to`, `fork_of`, `thread_title`. (Keep them on participation polls if those still exist — likely a partial drop with a `WHERE poll_type != 'participation'` data clear before the column drop.)
- Delete legacy single-poll API endpoints (`POST /api/polls`, `POST /api/polls/{id}/votes` per-poll variants, etc.). Or keep them as thin shims for participation polls only.
- Delete frontend dual-codepath branches.
- Begin participation poll phase-out as a separate sub-track (out of scope for this plan).

---

## How to start Phase 1

1. Create a new branch from `main` (e.g. `claude/multi-poll-phase-1-schema-and-api`).
2. Write `database/migrations/092_create_multipolls_up.sql` and `_down.sql`.
3. Apply on the dev droplet via the standard migration command in CLAUDE.md.
4. Add Pydantic models + endpoints + tests in `server/`.
5. Push, wait for the dev server to come up, demo with a `curl` that creates a 3-sub-poll multipoll and reads it back. Share the dev URL in the PR.
6. PR title: `Phase 1: multipoll schema and creation API`.

The frontend is **deliberately untouched** — Phase 1 ends here.
