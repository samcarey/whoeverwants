# Multipoll Redesign — Phasing Plan

This document breaks the multipoll redesign (see CLAUDE.md → "Multipoll System (In Progress)") into discrete, shippable phases. Phase 1 is fully specified here; later phases are sketched and will be refined when their turn comes.

The guiding principle: **every phase leaves `main` shippable**. Existing polls keep working through every step. The destructive cutover (migrating existing polls into multipoll wrappers) happens late, only after the new code paths have been exercised on freshly-created multipolls in production.

## Status snapshot

| Phase | Status | Notes |
|---|---|---|
| 1 — schema + create API | ✅ shipped (#198) | |
| 2.1 — FE plumbing | ✅ shipped (#199) | |
| 2.2 — single-poll create routes through multipolls | ✅ shipped (#200) | |
| 2.3 — What/When/Where bubble bar (thread-like pages only) | ✅ on this branch | Home keeps single + FAB; bubbles render on `isThreadLikePage`. |
| 4 — backfill existing polls | ✅ on this branch + applied to dev+prod | Migration 093. 151 prod polls wrapped, 21 follow_up_to + 2 fork_of rewrites. |
| 2.5 — multi-sub-poll rendering | ✅ on this branch | Sibling sub-polls join the thread via `multipoll_id`; thread page renders one card per sub-poll, sorted by `sub_poll_index`. |
| 2.4 — multi-sub-poll create UI | ⏳ not started | Phase plan below; the API supports it (multi-sub-poll multipolls can be POSTed today), but the create-poll modal still emits 1-sub-poll multipolls. |
| 3 — multipoll-level operations + thread card aggregation | ⏳ not started | |
| 5 — cleanup of legacy columns + dual-codepath branches | ⏳ not started | High blast radius; deferred. |

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

Phase 2 is too big to ship in one PR. It's split into five sub-phases, each shippable on its own. Sub-phases 2.1–2.3 are pure plumbing / single-button replacement; 2.4 introduces the dual-modal multi-sub-poll UI; 2.5 wires up rendering for multi-sub-poll multipolls.

The cardinal rule for every sub-phase: **legacy single polls keep working unchanged**. Mixed state (some polls have `multipoll_id`, some don't) is the norm through the rest of the rollout.

### Phase 2.1 — API client + types + cache plumbing (no UI change)

Smallest meaningful first step. Pure additive plumbing on the frontend:

- `lib/types.ts`: add `Multipoll` and `MultipollSubPoll` interfaces matching `MultipollResponse` / `PollResponse` from the server.
- `lib/api.ts`: `apiCreateMultipoll`, `apiGetMultipollByShortId`, `apiGetMultipollById` helpers. Coalesce concurrent fetches via the existing `coalesced()` idiom. Cache results.
- `lib/pollCache.ts`: `multipollCache` keyed by id and short_id. 60s TTL. `cacheMultipoll`, `getCachedMultipollById`, `getCachedMultipollByShortId`, `invalidateMultipoll`. Sub-polls are cached via the existing `cachePoll()` since they're plain `Poll` objects.
- No component or page changes. No new entry points exercise these helpers yet.

Done criteria: helpers exist, are typed, build cleanly. No behavior change visible to users. Can be exercised manually via browser devtools (`window.__apiCreateMultipoll = ...` for ad-hoc curl-like testing) or by writing a one-off test page.

### Phase 2.2 — Single-button "+" routes through `POST /api/multipolls` ✅

Switched the existing create-poll flow to write multipolls under the hood — UI stays exactly the same (one big create form, one Submit button → one sub-poll wrapped in one multipoll).

- `app/create-poll/page.tsx` submit handler: builds a `CreateMultipollRequest` with exactly one `CreateSubPollRequest` (`pollDataToMultipollRequest()`) and calls `apiCreateMultipoll`. Participation polls keep using `apiCreatePoll`. On success navigate to `/p/<multipoll.short_id>/`.
- `app/p/[shortId]/page.tsx` loader: tries `apiGetMultipollByShortId` / `apiGetMultipollById` first; on 404 falls back to `apiGetPollByShortId` / `apiGetPollById`. For 1-sub-poll multipolls, the single sub-poll is fed into `ThreadContent` as `initialExpandedPollId` exactly like today. Cache lookups (`getCachedMultipoll*`) are tried synchronously first so warm hits render on first paint.
- `app/thread/[threadId]/page.tsx` and `lib/threadUtils.ts`: unchanged — they still walk the polls table. The polls row gets `follow_up_to` / `fork_of` written by `_insert_sub_poll`, so legacy thread aggregation finds the chain transparently.
- Server resolution: `CreateMultipollRequest.follow_up_to` / `fork_of` are POLL ids (matching the legacy single-poll API). `_resolve_parent_multipoll_id` looks up the parent poll's `multipoll_id` for the multipolls row; legacy parents resolve to `NULL`. `_insert_sub_poll` writes the original poll_id onto each sub-poll's `polls.follow_up_to` / `polls.fork_of`. `_insert_multipoll` falls back to the legacy parent poll's `thread_title` via a second `COALESCE` branch.
- `is_auto_title` is now part of `CreateSubPollRequest` so subsequent fork/duplicate flows preserve auto-title state.
- `next.config.ts` rewrites: `/api/multipolls`, `/api/multipolls/`, and `/api/multipolls/:path*` proxy to the backend so the FE same-origin fetches work.
- Six new server tests cover the chain propagation (followup→multipoll, followup→legacy, fork_of→multipoll, thread_title inheritance from both kinds of parent, explicit-title-wins).

Done: creating a poll (regular, follow-up, fork, duplicate) writes a multipoll wrapper + 1 sub-poll. URL is the multipoll's short_id. Existing thread / poll pages render the new poll identically to before. Existing legacy polls (no `multipoll_id`) keep working.

### Phase 2.3 — What/When/Where FAB on home + thread (still single sub-poll)

Visual change to the FAB; behavior is equivalent to a category-prefilled tap of the old `+` button.

- Replace the single `+` floating action button (`app/template.tsx` portal target, `#floating-fab-portal`) with three equally-spaced bubble buttons: **What** / **When** / **Where**.
- Each bubble opens the existing create-poll modal with the category preselected:
  - **What** → no preselection (user picks from dropdown excluding location/restaurant/time).
  - **When** → category locked to `time`.
  - **Where** → category dropdown limited to location-like categories (restaurant, location, custom).
- Empty thread placeholder (`/thread/new`) gets the same three bubbles instead of the old single `+`.
- No multi-sub-poll yet; the modal still creates exactly one sub-poll on submit.
- Update CLAUDE.md "Navigation Layout" to describe the three-bubble FAB.

Done criteria: home + thread + `/thread/new` show three bubbles. Each opens the create-poll modal pre-set to the right category. Submit produces a 1-sub-poll multipoll.

### Phase 2.4 — Dual-modal multi-sub-poll create flow

The big UI change: the top sheet stages a single sub-poll, the bottom sheet holds shared multipoll fields, and the user can add multiple sub-polls before submitting.

- Bottom modal (shared multipoll fields): optional `context`, voting cutoff (`response_deadline`), optional shared prephase cutoff (`prephase_deadline_minutes`). Slides up only as far as needed for its content.
- Top modal (per-sub-poll): category + options + optional per-sub-poll `context`. Has a checkmark in its top-right corner that commits the sub-poll to a draft slot.
- Draft slots: compact rows displayed above the bottom form showing each staged sub-poll's category + summary. The What/When/Where bubbles reappear above the bottom form between commits so the user can add more sub-polls.
- localStorage draft persistence (per-tab, per-device): preserve draft state across modal close + reopen, browser refresh, etc.
- Submit calls `POST /api/multipolls` with all staged sub-polls. On success → `/p/<multipoll.short_id>/`.
- Validation in the UI mirrors the server: ≥1 sub-poll, ≤1 time sub-poll, same-kind sub-polls require distinct contexts, no participation polls.
- Auto-title preview in the bottom modal header (mirrors `generate_multipoll_title` logic).

Done criteria: user can create 2+ sub-poll multipolls. Reopening the modal mid-create preserves the draft. Server returns 201 and the URL navigates to a multi-sub-poll multipoll page (rendered in 2.5).

### Phase 2.5 — Render multi-sub-poll multipolls (read-only display, per-sub-poll voting) ✅

Sibling sub-polls (sharing a `multipoll_id`) now join the thread automatically.

- `lib/threadUtils.ts`: `buildPollMaps` builds a `siblingsOf` map from `multipoll_id`. `collectDescendants` enqueues siblings when visiting a poll. Sort breaks shared-`created_at` ties via `sub_poll_index` so sub-polls render in the order the creator added them.
- `lib/types.ts`, `lib/api.ts`: `Poll` carries `multipoll_id` + `sub_poll_index`; `toPoll` maps both.
- `server/models.py`, `server/routers/polls.py`: `PollResponse` exposes both fields; `_row_to_poll` maps from the DB.
- `server/algorithms/related_polls.py`, `server/routers/polls.py:/related`: discovery walks `multipoll_id` so visiting one sub-poll grants access to its siblings.
- `app/p/[shortId]/page.tsx` is unchanged: it still picks `multipoll.sub_polls[0]` as the anchor for `findThreadRootRouteId`. With siblings now in the thread, that's enough — the rendered thread includes every sub-poll.

Single-sub-poll multipolls (the post-Phase-4 norm) are unaffected — `siblingsOf` has no entry for them, behavior is identical to the legacy follow_up_to walk.

Voting/results remain per-sub-poll. Each sub-poll's card still has its own Submit. Phase 3 unifies these.

The rendering DOES result in a few cosmetic quirks worth flagging for Phase 3 polish:
- All sub-polls share the same auto-generated multipoll title (e.g. `"Yes/No and Restaurant for Birthday"`), so each card's title is identical. The per-sub-poll `context` IS displayed inside the card (it's the `details` field on the sub-poll), but the `<h3>` header still shows the wrapper title.
- The thread card respondent row + footer pill render per-sub-poll, not multipoll-aggregated.
- Long-press → close/reopen still hits per-sub-poll endpoints, so a "close multipoll" needs N taps for N sub-polls.

These are intentionally deferred to Phase 3.

### Cross-cutting concerns for Phase 2

- **Cache invalidation**: every multipoll mutation (create, vote propagation, close — Phase 3) needs to call `invalidateMultipoll()` and `invalidateAccessiblePolls()`. Phase 2 only has create, but lay the helper down in 2.1.
- **`pollDiscovery.ts`**: walks `follow_up_to` chains on polls. Once 2.2 propagates `follow_up_to` to the polls row for sub-polls, discovery keeps working. If we later switch the source of truth to multipolls.follow_up_to, discovery needs an update.
- **PWA cache**: snapshot helpers (`buildPollSnapshot` in `lib/pollCreator.ts`) used for fork/duplicate/follow-up are unchanged through Phase 2 — they still operate on a single `Poll`. Phase 2.4's draft persistence is a separate localStorage store.

### Open questions for Phase 2 (revisit during sub-phase implementation)

- How do Follow-Up / Fork / Duplicate compose with the new What/When/Where flow in 2.4? Likely: prefill a single What/When/Where draft slot matching the source's category, then the user can add more.
- Does 2.4's bottom modal show the "shared prephase cutoff" only when at least one staged sub-poll has a prephase? (Probably yes — yes/no-only multipolls don't need a prephase cutoff.)
- Should `apiGetMultipoll` also seed the per-sub-poll `pollCache` so subsequent `apiGetPollById` calls hit warm cache? (Probably yes — minor perf win, easy to do in the helper.)

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
