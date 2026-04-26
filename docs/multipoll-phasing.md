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
| 2.4 — multi-sub-poll create UI | ✅ on this branch | `+ Add another section` stages yes_no/ranked_choice drafts; submit prepends them to the multipoll request. MVP scope per the "minimal path" below. |
| 3.1 — multipoll-level close/reopen/cutoff endpoints | ✅ on this branch | New `POST /api/multipolls/{id}/{close,reopen,cutoff-suggestions,cutoff-availability}` endpoints close/reopen/cutoff the wrapper + every sub-poll atomically. Thread page long-press handlers route to the multipoll endpoint when `poll.multipoll_id` is set, optimistically updating every sibling. |
| 3.2 — thread card aggregation | ✅ on this branch | Sibling sub-polls render in one card with stacked sub-poll sections; respondent row + copy-link route through the multipoll. Server adds `voter_names` + `anonymous_count` to `MultipollResponse` so the FE never aggregates sub-poll vote rows. Multi-yes_no group external rendering is deferred to Phase 3.3 (unified Submit). |
| 3.2 follow-up — stacked compact pills | ✅ on this branch | Multi-sub-poll cards now render one compact pill per sub-poll, stacked vertically inside a single `CompactPreviewClip` so the column animates as a unit. Single-sub-poll groups unchanged. |
| 3.3 — non-anchor yes_no external rendering | ✅ on this branch | Every yes_no sub-poll in a multi-group now uses the thread-page external Yes/No card (with tap-to-change → confirmation flow) instead of falling back to `SubPollBallot`'s internal yes_no UI for non-anchor sub-polls. External card render moved into the per-sub-poll loop so cards inherit the section label and the proper sibling order. |
| 3.4 — unified vote endpoint (server + FE helper) | ✅ on this branch | `POST /api/multipolls/{id}/votes` accepts a list of `{sub_poll_id, vote_id?, ...vote payload}` items + a single multipoll-level `voter_name`, applied atomically. Each item inserts (vote_id null) or updates (vote_id set); any item failure rolls back the batch. `_submit_vote_to_poll` / `_edit_vote_on_poll` extracted as shared helpers used by both the per-poll endpoints and the new multipoll one. FE helper `apiSubmitMultipollVotes` cascades cache invalidation through `invalidateMultipoll`. |
| 3.4 follow-up A — multipoll-level Submit for multi-sub-poll groups | 🚧 in progress on this branch | Hide per-sub-poll Submit/voter-name/confirmation in `SubPollBallot` when it's a sub-poll of a multi-sub-poll group; render one Submit + voter name + confirmation at the multipoll wrapper level (the thread-page card group). SubPollBallot exposes `getVoteItem()` / `applyVoteResult()` via ref. Single-sub-poll multipolls keep their existing SubPollBallot Submit in this PR (lifted in PR B). |
| 3.4 follow-up A.5 — `SubPollBallot.submitVote` routes through `apiSubmitMultipollVotes` | ✅ on this branch | The last per-poll `apiSubmitVote`/`apiEditVote` client callsite (covering ranked_choice / suggestion / time + the unreachable yes_no path) routes through the multipoll endpoint when `poll.multipoll_id` is set. Legacy per-poll branch is preserved as a fallback for `multipoll_id == null` (participation polls + any pre-Phase-4 unbackfilled poll). Decouples the "use the multipoll endpoint" rule from the "lift Submit out of SubPollBallot" UI refactor so follow-up B is a pure render-tree change. |
| 3.4 follow-up B — multipoll-level Submit for single-sub-poll multipolls + rename | ✅ on this branch (1-sub-poll case) | `lib/ballotDraft.ts` is now per-multipoll: storage key `ballotDraft:m:<multipollId>` holds `{voter_name?, sub_polls: { [subPollId]: SubPollDraft } }`. `loadSubPollDraft(multipollId, subPollId)` / `saveSubPollDraft(...)` / `clearSubPollDraft(...)` route through the multipoll entry; legacy per-sub-poll entries auto-migrate on read; participation polls (`multipollId === null`) keep the legacy per-poll key. The component formerly known as `SubPollBallot` is now `components/SubPollBallot.tsx` (moved out of `app/p/[shortId]/`, renamed). **Submit/voter-name lifted to the multipoll wrapper for every 1-sub-poll non-yes_no multipoll**: `SubPollBallot` is now a `forwardRef` component exposing `SubPollBallotHandle.triggerSubmit()`; new props `wrapperHandlesSubmit`, `externalVoterName`/`setExternalVoterName`, `onWrapperSubmitStateChange` let the thread page render Submit + voter name + label externally while the existing 361-line `submitVote` flow stays put inside `SubPollBallot`. RankingSection + SuggestionVotingInterface accept `wrapperHandlesSubmit` and skip their internal Submit/voter-name when true. Submit visibility + label (`Submit Vote` / `Submit Availability` / `Submit Preferences`) flow back via the state callback so the wrapper button mirrors what the inline button used to render. Yes/no in 1-sub-poll multipolls is unaffected — already wrapper-driven via the external PollResultsDisplay tap-to-change → confirmVoteChange flow. **Still pending: mixed-type multi-sub-poll groups** (e.g. yes_no + ranked_choice) — those still render N Submit buttons until a follow-up PR adds an atomic batch path through the ref API + apiSubmitMultipollVotes. (`apiSubmitVote`/`apiEditVote` callsites already retired in 3.4 follow-up A.5.) |
| 3.5 — multipoll-level `follow_up_to` / `fork_of` as source of truth | ⏳ not started | Schema columns exist (Phase 1) and are populated on create. FE thread aggregation still walks `polls.follow_up_to`. Switching the source-of-truth requires `lib/threadUtils.ts` + `pollDiscovery.ts` + `lib/useThread.ts` updates and at least one server-side endpoint that exposes multipoll chains. |
| 5 — cleanup of legacy columns + dual-codepath branches | ⏳ not started | High blast radius; deferred. |

## Architectural decisions (ratified during Phase 3.4 follow-up planning)

These decisions narrow the design space for everything from Phase 3.4 follow-up onward. Refer back to them rather than re-deriving in subsequent phases.

- **Sub-polls cannot exist or be submitted by themselves.** A sub-poll is always a section of a multipoll. The multipoll is the unit of identity, sharing, voting, and submission. Even 1-sub-poll multipolls (the prod norm post-Phase-4) submit through the multipoll-level path; there is no per-sub-poll Submit anywhere in the UI. (Today there still is — it's lifted in Phase 3.4 follow-up B.)
- **Multipoll-level state lives on the multipoll wrapper component.** The wrapper owns: voter name input, Submit button, confirmation modal, "you voted / Edit" overall state, vote-changed event dispatch, cache invalidation. None of these belong inside a sub-poll component.
- **Sub-poll-level state lives on the sub-poll component.** It owns: category-specific ballot UI (yes/no buttons, RankableOptions, TimeSlotBubbles, suggestion entry), per-sub-poll abstain control, per-sub-poll ranking/preferences state, section label / context display.
- **Abstaining is per-sub-poll, not per-multipoll.** A voter abstains on a specific sub-ballot (e.g. abstain on the restaurant question, vote yes on the date question). There is no single "abstain from this whole multipoll" toggle. Each sub-poll's abstain control is rendered inside that sub-poll's section.
- **Ballot draft is per-multipoll.** One localStorage entry per multipoll (keyed by multipoll_id) holding `{voter_name, sub_polls: { [sub_poll_id]: SubPollDraft } }`. Voter name is shared across the multipoll; per-sub-poll state is keyed by sub-poll id inside the entry. (Today the draft is keyed by sub-poll id; re-keyed in Phase 3.4 follow-up B.)
- **Vote submission is always atomic across the multipoll.** Every vote write goes through `POST /api/multipolls/{id}/votes` as a single transaction. The per-poll `apiSubmitVote` / `apiEditVote` callsites become legacy — phased out in Phase 3.4 follow-up B and removed entirely in Phase 5.
- **The yes/no external-rendering carve-out is a transitional artifact.** It exists today because SubPollBallot owns Submit for yes_no but the thread page wants the winner card to render in a stable DOM position. Once Submit is multipoll-level, all sub-poll UI is "external" to the wrapper, and the carve-out collapses into "the wrapper renders some things above each sub-poll's ballot section, some things below."

## What's next — concrete starting points

After the Phase 2.3 fix + Phase 4 + Phase 2.5 cutover, the multipoll **architecture** is in place: every non-participation poll has a wrapper, the FE+API exchange `multipoll_id` + `sub_poll_index`, and sibling sub-polls render together in threads. The remaining phases are user-visible improvements layered on this foundation.

### Phase 2.4 (multi-sub-poll create UI) — minimal path

The simplest version that delivers user-facing multi-sub-poll creation without rewriting the modal:

1. Refactor the long inline pollData construction in `app/create-poll/page.tsx: handleSubmit` into two helpers:
   - `buildSubPollFromState(): CreateSubPollParams | null` — extracts per-sub-poll fields from current state, returns null on validation failure.
   - `buildMultipollSharedFromState(): { creator_secret, response_deadline, ... }` — returns the multipoll-level fields.
2. Add `const [stagedSubPolls, setStagedSubPolls] = useState<CreateSubPollParams[]>([])`.
3. Add a "+ Add another section" button below the form. Click handler:
   - Calls `buildSubPollFromState()`. If null, surface validation error.
   - Pushes to `stagedSubPolls`.
   - Resets per-sub-poll state (title to '', isAutoTitle to true, options to [''], category to 'custom', forField to '', refLatLng/Label cleared, dayTimeWindows to [], etc.). Keep shared state (creatorName, deadlineOption + customDate/Time, details, suggestionCutoff, follow_up_to / fork_of / duplicateOf).
4. Add a compact list above the form showing each staged sub-poll (category icon + first option / context, plus an X to remove).
5. Modify `pollDataToMultipollRequest` to accept an optional `additionalSubPolls: CreateSubPollParams[]` parameter and merge them ahead of the current sub-poll.
6. Persist `stagedSubPolls` in `pollFormState` localStorage so a modal close+reopen preserves the draft.

Skip in MVP: per-sub-poll context UI, time-poll staging (server enforces ≤1 time sub-poll), edit-staged (only support add/remove), the "dual-modal" visual layout (a single modal with a draft list is functionally equivalent).

Server-side validation already enforces: at least 1 sub-poll, ≤1 time sub-poll, distinct contexts for same-kind sub-polls, no participation polls. Surface server 400 errors verbatim and the user iterates.

### Phase 3 — thread card aggregation

Today, multi-sub-poll multipolls render as N separate cards in the thread list (each sub-poll = one card, grouped via `multipoll_id` siblings in `collectDescendants`). For Phase 3, group them under a single visual "card group" that shows the multipoll header once and stacks sub-poll ballots inside.

Practical refactor:
- `app/thread/[threadId]/page.tsx` currently maps over `thread.polls`. Change it to map over `groupedByMultipollId`, where 1-sub-poll multipolls render as today and multi-sub-poll groups render as one card with multiple sub-poll sections.
- The auto-title `"Yes/No and Restaurant for Birthday"` is identical across sub-polls, so the group header reads cleanly. Per-sub-poll context (`polls.details`) labels each section inside.
- `findThreadRootRouteId` and `lib/pollBackTarget.ts` still operate on POLL ids; keep them unchanged. Only the rendering changes.

Multipoll-level operations (close, reopen, follow-up, fork) need new server endpoints:
- `POST /api/multipolls/{id}/close` — atomic close all sub-polls + the wrapper.
- `POST /api/multipolls/{id}/reopen` — atomic reopen.
- The long-press modal in the thread page should call these for multi-sub-poll multipolls and the per-sub-poll endpoints for single-sub-poll wrappers (or always the multipoll endpoint after migration is complete).

### Phase 5 — cleanup

This is the riskiest phase because dropping columns from `polls` requires every read path to source those fields from `multipolls` instead. Order of operations:

1. **Frontend**: stop reading wrapper-level fields (`response_deadline`, `is_closed`, `creator_secret`, `thread_title`, `follow_up_to`, `fork_of`, `short_id`) off the `Poll` object. Always source them from the parent `Multipoll`. Some of these are in many places — careful refactor.
2. **Server**: stop returning the wrapper-level fields on `PollResponse`. Keep them populated in DB rows (still needed for `WHERE` queries) but not in API responses.
3. **One migration per dropped column** (incremental, testable). Don't drop them all at once.
4. **Participation polls keep their own copies** of these columns since they have no wrapper. Either branch the SQL or keep separate column ownership.

Recommended deferral: do this as a series of small PRs after Phase 2.4 + 3 land and the new code paths have been exercised on production for a couple of weeks. Risks include: broken share links (if `short_id` migration mishandles), broken creator authentication (if `creator_secret` removed prematurely), broken thread pages (if `follow_up_to` stops being populated on `polls`).

---

## Addressability paradigm (applies across all phases)

**The multipoll is the addressable unit. Sub-polls are internal-only.**

- **URLs reference multipolls, never sub-polls.** Multipolls own `id` + `short_id` and are the targets of `/p/<short_id>/` and `/thread/<id>/`. Sub-poll uuids exist for foreign-key plumbing inside the DB but are not URL-able. Any "share this", "copy link", "navigate to", or "related thread" computation routes through the multipoll, never a sub-poll uuid.
- **Multipoll-level state lives at the multipoll level — no client-side aggregation.** Voter participation list, total respondent count, "is this poll closed", deadline, creator, follow-up/fork chain, vote-submission unit (Phase 3+), close/reopen/cutoff target — all these are multipoll-level concepts. They MUST be sourced from a multipoll-level endpoint or field on `MultipollResponse`. The FE never iterates `multipoll.sub_polls` to compute multipoll-level state. If the data doesn't exist at the multipoll level today, the right fix is to surface it at that level (server field or new endpoint), not to aggregate on the client.
- **Per-sub-poll state still flows per-sub-poll.** Ballots, options, suggestions, time slots, ranking interactions, sub-poll results — all continue to use `/api/polls/<sub-poll-id>` endpoints. The paradigm is about MULTIPOLL-LEVEL aggregates, not about deprecating sub-poll plumbing.
- **Internal client identifiers can still use sub-poll ids freely.** Refs, cache keys, DOM `key=` props, expand state — these are not URLs and not API contracts. Sub-poll ids work fine here.

When designing any feature in this rollout, ask: *"is this a multipoll-level concept?"* If yes → route through a multipoll endpoint/field. Never sum/dedupe across sub-polls in the browser.

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
