# Poll Redesign — Phasing Plan

This document breaks the poll redesign (see CLAUDE.md → "Poll System (In Progress)") into discrete, shippable phases. Phase 1 is fully specified here; later phases are sketched and will be refined when their turn comes.

The guiding principle: **every phase leaves `main` shippable**. Existing questions keep working through every step. The destructive cutover (migrating existing questions into poll wrappers) happens late, only after the new code paths have been exercised on freshly-created polls in production.

> **Note (2026-04-27):** the participation question type was removed entirely in
> migration 094. Older entries below that mention participation as a separate
> codepath, "no wrapper", or "kept as legacy fallback" are stale — every question
> now has a poll wrapper.
>
> **Note (2026-04-27 — same day):** forks were removed entirely in migration
> 095. Threads are now formed only via `follow_up_to` chains. Older entries
> below that mention `fork_of`, `ForkButton`, `ForkHeader`, `?fork=<id>`, or
> "fork-data-*" are stale.

## Status snapshot

| Phase | Status | Notes |
|---|---|---|
| 1 — schema + create API | ✅ shipped (#198) | |
| 2.1 — FE plumbing | ✅ shipped (#199) | |
| 2.2 — single-question create routes through polls | ✅ shipped (#200) | |
| 2.3 — What/When/Where bubble bar (thread-like pages only) | ✅ on this branch | Home keeps single + FAB; bubbles render on `isThreadLikePage`. |
| 4 — backfill existing questions | ✅ on this branch + applied to dev+prod | Migration 093. 151 prod questions wrapped, 21 follow_up_to + 2 fork_of rewrites. |
| 2.5 — multi-question rendering | ✅ on this branch | Sibling questions join the thread via `poll_id`; thread page renders one card per question, sorted by `question_index`. |
| 2.4 — multi-question create UI | ✅ on this branch | `+ Add another section` stages yes_no/ranked_choice drafts; submit prepends them to the poll request. MVP scope per the "minimal path" below. |
| 3.1 — poll-level close/reopen/cutoff endpoints | ✅ on this branch | New `POST /api/polls/{id}/{close,reopen,cutoff-suggestions,cutoff-availability}` endpoints close/reopen/cutoff the wrapper + every question atomically. Thread page long-press handlers route to the poll endpoint when `question.poll_id` is set, optimistically updating every sibling. |
| 3.2 — thread card aggregation | ✅ on this branch | Sibling questions render in one card with stacked question sections; respondent row + copy-link route through the poll. Server adds `voter_names` + `anonymous_count` to `PollResponse` so the FE never aggregates question vote rows. Multi-yes_no group external rendering is deferred to Phase 3.3 (unified Submit). |
| 3.2 follow-up — stacked compact pills | ✅ on this branch | Multi-question cards now render one compact pill per question, stacked vertically inside a single `CompactPreviewClip` so the column animates as a unit. Single-question groups unchanged. |
| 3.3 — non-anchor yes_no external rendering | ✅ on this branch | Every yes_no question in a multi-group now uses the thread-page external Yes/No card (with tap-to-change → confirmation flow) instead of falling back to `QuestionBallot`'s internal yes_no UI for non-anchor questions. External card render moved into the per-question loop so cards inherit the section label and the proper sibling order. |
| 3.4 — unified vote endpoint (server + FE helper) | ✅ on this branch | `POST /api/polls/{id}/votes` accepts a list of `{question_id, vote_id?, ...vote payload}` items + a single poll-level `voter_name`, applied atomically. Each item inserts (vote_id null) or updates (vote_id set); any item failure rolls back the batch. `_submit_vote_to_question` / `_edit_vote_on_question` extracted as shared helpers used by both the per-question endpoints and the new poll one. FE helper `apiSubmitPollVotes` cascades cache invalidation through `invalidatePoll`. |
| 3.4 follow-up A — poll-level Submit for multi-question groups | 🚧 in progress on this branch | Hide per-question Submit/voter-name/confirmation in `QuestionBallot` when it's a question of a multi-question group; render one Submit + voter name + confirmation at the poll wrapper level (the thread-page card group). QuestionBallot exposes `getVoteItem()` / `applyVoteResult()` via ref. Single-question polls keep their existing QuestionBallot Submit in this PR (lifted in PR B). |
| 3.4 follow-up A.5 — `QuestionBallot.submitVote` routes through `apiSubmitPollVotes` | ✅ on this branch | The last per-question `apiSubmitVote`/`apiEditVote` client callsite (covering ranked_choice / suggestion / time + the unreachable yes_no path) routes through the poll endpoint when `question.poll_id` is set. Legacy per-question branch is preserved as a fallback for `poll_id == null` (participation questions + any pre-Phase-4 unbackfilled question). Decouples the "use the poll endpoint" rule from the "lift Submit out of QuestionBallot" UI refactor so follow-up B is a pure render-tree change. |
| 3.4 follow-up B — poll-level Submit for single-question polls + rename | ✅ on this branch (1-question case) | `lib/ballotDraft.ts` is now per-poll: storage key `ballotDraft:m:<pollId>` holds `{voter_name?, questions: { [subQuestionId]: QuestionDraft } }`. `loadQuestionDraft(pollId, subQuestionId)` / `saveQuestionDraft(...)` / `clearQuestionDraft(...)` route through the poll entry; legacy per-question entries auto-migrate on read; participation questions (`pollId === null`) keep the legacy per-question key. The component formerly known as `QuestionBallot` is now `components/QuestionBallot.tsx` (moved out of `app/p/[shortId]/`, renamed). **Submit/voter-name lifted to the poll wrapper for every 1-question non-yes_no poll**: `QuestionBallot` is now a `forwardRef` component exposing `QuestionBallotHandle.triggerSubmit()`; new props `wrapperHandlesSubmit`, `externalVoterName`/`setExternalVoterName`, `onWrapperSubmitStateChange` let the thread page render Submit + voter name + label externally while the existing 361-line `submitVote` flow stays put inside `QuestionBallot`. RankingSection + SuggestionVotingInterface accept `wrapperHandlesSubmit` and skip their internal Submit/voter-name when true. Submit visibility + label (`Submit Vote` / `Submit Availability` / `Submit Preferences`) flow back via the state callback so the wrapper button mirrors what the inline button used to render. Yes/no in 1-question polls is unaffected — already wrapper-driven via the external QuestionResultsDisplay tap-to-change → confirmVoteChange flow. |
| 3.4 follow-up B — poll-level Submit for mixed-type multi-question groups | ✅ on this branch | Mixed-type multi-question groups (e.g. yes_no + ranked_choice) now batch through ONE wrapper Submit + ONE ConfirmationModal + ONE atomic `apiSubmitPollVotes` call. `usePollSubmit` gate drops the `allYesNo` carve-out — fires for every multi-group with a poll wrapper. New `QuestionBallotHandle.prepareBatchVoteItem()` ref method synchronously validates + builds a `PollVoteItem` and returns `commit(vote)` / `fail(error)` closures capturing per-question state at build time. Wrapper button click snapshots staged yes_no choices + calls `prepareBatchVoteItem()` on each non-yes_no ref, aggregates items + closures into `pendingPollSubmit.preparedNonYesNo`, opens the modal; on confirm `confirmPollSubmit` builds the combined items array and calls `apiSubmitPollVotes` once. Returned `ApiVote`s distributed via `commit(vote)` per non-yes_no entry + `userVoteMap` updates per yes_no. Validation errors surface inline (via `setVoteError`) AND abort modal opening so the user fixes them before re-clicking Submit. (`apiSubmitVote`/`apiEditVote` callsites already retired in 3.4 follow-up A.5; the legacy branches remain as participation-question fallbacks.) |
| 3.5 — poll-level `follow_up_to` as source of truth | ✅ on this branch | `QuestionResponse` carries `poll_follow_up_to` (the wrapper's follow_up_to, populated via `LEFT JOIN polls` in every server SELECT that feeds `_row_to_question`). FE `lib/threadUtils.ts` walks poll-level chains: `buildQuestionMaps` returns `questionIdsByPoll` + `childrenByParentPoll`; `collectDescendants` fans every visited question out to siblings + parent's siblings + every child poll's questions. `findThreadRootRouteId(question, questionByPoll?)` walks the chain to root. Server `algorithms/related_questions.py` discovery walks poll-level chains; `QuestionRelation` carries `poll_id` + `poll_follow_up_to`. The legacy `questions.follow_up_to` column is still populated on writes (Phase 5 retires it) but the FE no longer reads it for chain logic. **Forks were removed entirely in migration 095** as part of this work — only `follow_up_to` remains. |
| 5 — cleanup of legacy columns + dual-codepath branches | ✅ on this branch | Migration 096 dropped questions.{short_id, creator_secret, creator_name, response_deadline, is_closed, close_reason, follow_up_to, thread_title, suggestion_deadline, sequential_id} along with the BEFORE-INSERT `trigger_generate_short_id`. The polls table is now the sole source of truth for wrapper-level fields. Server `_SELECT_QUESTION_FULL` LEFT JOINs questions + polls and aliases the wrapper fields under the legacy questions column names so internal logic that reads `row["is_closed"]` etc. keeps working — and so `QuestionResponse` continues to surface them to the FE without a 30-file callsite refactor. Legacy single-question mutation endpoints removed: `POST /api/questions`, `POST /api/questions/{id}/{votes,close,reopen,cutoff-suggestions,cutoff-availability,thread-title}`, `PUT /api/questions/{id}/votes/{vote_id}`. New poll-level `POST /api/polls/{id}/thread-title`. FE drops `apiCreateQuestion`/`apiSubmitVote`/`apiEditVote`/`apiCloseQuestion`/`apiReopenQuestion`/`apiCutoffSuggestions`/`apiCutoffAvailability`/`apiUpdateThreadTitle`; new `apiUpdatePollThreadTitle`. `Question.follow_up_to` field removed (use `poll_follow_up_to`). `FollowUpHeader` takes a poll_id and resolves via `apiGetPollById`. Phase 5b (deferred): refactor FE callsites that read `question.is_closed`/`question.response_deadline`/etc. to source from the `Poll` wrapper directly. |

## Architectural decisions (ratified during Phase 3.4 follow-up planning)

These decisions narrow the design space for everything from Phase 3.4 follow-up onward. Refer back to them rather than re-deriving in subsequent phases.

- **Sub-questions cannot exist or be submitted by themselves.** A question is always a section of a poll. The poll is the unit of identity, sharing, voting, and submission. Even 1-question polls (the prod norm post-Phase-4) submit through the poll-level path; there is no per-question Submit anywhere in the UI. (Today there still is — it's lifted in Phase 3.4 follow-up B.)
- **Poll-level state lives on the poll wrapper component.** The wrapper owns: voter name input, Submit button, confirmation modal, "you voted / Edit" overall state, vote-changed event dispatch, cache invalidation. None of these belong inside a question component.
- **Sub-question-level state lives on the question component.** It owns: category-specific ballot UI (yes/no buttons, RankableOptions, TimeSlotBubbles, suggestion entry), per-question abstain control, per-question ranking/preferences state, section label / context display.
- **Abstaining is per-question, not per-poll.** A voter abstains on a specific sub-ballot (e.g. abstain on the restaurant question, vote yes on the date question). There is no single "abstain from this whole poll" toggle. Each question's abstain control is rendered inside that question's section.
- **Ballot draft is per-poll.** One localStorage entry per poll (keyed by poll_id) holding `{voter_name, questions: { [question_id]: QuestionDraft } }`. Voter name is shared across the poll; per-question state is keyed by question id inside the entry. (Today the draft is keyed by question id; re-keyed in Phase 3.4 follow-up B.)
- **Vote submission is always atomic across the poll.** Every vote write goes through `POST /api/polls/{id}/votes` as a single transaction. The per-question `apiSubmitVote` / `apiEditVote` callsites become legacy — phased out in Phase 3.4 follow-up B and removed entirely in Phase 5.
- **The yes/no external-rendering carve-out is a transitional artifact.** It exists today because QuestionBallot owns Submit for yes_no but the thread page wants the winner card to render in a stable DOM position. Once Submit is poll-level, all question UI is "external" to the wrapper, and the carve-out collapses into "the wrapper renders some things above each question's ballot section, some things below."

## What's next — concrete starting points

After the Phase 2.3 fix + Phase 4 + Phase 2.5 cutover, the poll **architecture** is in place: every non-participation question has a wrapper, the FE+API exchange `poll_id` + `question_index`, and sibling questions render together in threads. The remaining phases are user-visible improvements layered on this foundation.

### Phase 2.4 (multi-question create UI) — minimal path

The simplest version that delivers user-facing multi-question creation without rewriting the modal:

1. Refactor the long inline questionData construction in `app/create-question/page.tsx: handleSubmit` into two helpers:
   - `buildQuestionFromState(): CreateQuestionParams | null` — extracts per-question fields from current state, returns null on validation failure.
   - `buildPollSharedFromState(): { creator_secret, response_deadline, ... }` — returns the poll-level fields.
2. Add `const [stagedQuestions, setStagedQuestions] = useState<CreateQuestionParams[]>([])`.
3. Add a "+ Add another section" button below the form. Click handler:
   - Calls `buildQuestionFromState()`. If null, surface validation error.
   - Pushes to `stagedQuestions`.
   - Resets per-question state (title to '', isAutoTitle to true, options to [''], category to 'custom', forField to '', refLatLng/Label cleared, dayTimeWindows to [], etc.). Keep shared state (creatorName, deadlineOption + customDate/Time, details, suggestionCutoff, follow_up_to / fork_of / duplicateOf).
4. Add a compact list above the form showing each staged question (category icon + first option / context, plus an X to remove).
5. Modify `questionDataToPollRequest` to accept an optional `additionalQuestions: CreateQuestionParams[]` parameter and merge them ahead of the current question.
6. Persist `stagedQuestions` in `questionFormState` localStorage so a modal close+reopen preserves the draft.

Skip in MVP: per-question context UI, time-question staging (server enforces ≤1 time question), edit-staged (only support add/remove), the "dual-modal" visual layout (a single modal with a draft list is functionally equivalent).

Server-side validation already enforces: at least 1 question, ≤1 time question, distinct contexts for same-kind questions, no participation questions. Surface server 400 errors verbatim and the user iterates.

### Phase 3 — thread card aggregation

Today, multi-question polls render as N separate cards in the thread list (each question = one card, grouped via `poll_id` siblings in `collectDescendants`). For Phase 3, group them under a single visual "card group" that shows the poll header once and stacks question ballots inside.

Practical refactor:
- `app/thread/[threadId]/page.tsx` currently maps over `thread.questions`. Change it to map over `groupedByPollId`, where 1-question polls render as today and multi-question groups render as one card with multiple question sections.
- The auto-title `"Yes/No and Restaurant for Birthday"` is identical across questions, so the group header reads cleanly. Per-question context (`questions.details`) labels each section inside.
- `findThreadRootRouteId` and `lib/questionBackTarget.ts` still operate on QUESTION ids; keep them unchanged. Only the rendering changes.

Poll-level operations (close, reopen, follow-up, fork) need new server endpoints:
- `POST /api/polls/{id}/close` — atomic close all questions + the wrapper.
- `POST /api/polls/{id}/reopen` — atomic reopen.
- The long-press modal in the thread page should call these for multi-question polls and the per-question endpoints for single-question wrappers (or always the poll endpoint after migration is complete).

### Phase 5 — cleanup

This is the riskiest phase because dropping columns from `questions` requires every read path to source those fields from `polls` instead. Order of operations:

1. **Frontend**: stop reading wrapper-level fields (`response_deadline`, `is_closed`, `creator_secret`, `thread_title`, `follow_up_to`, `fork_of`, `short_id`) off the `Question` object. Always source them from the parent `Poll`. Some of these are in many places — careful refactor.
2. **Server**: stop returning the wrapper-level fields on `QuestionResponse`. Keep them populated in DB rows (still needed for `WHERE` queries) but not in API responses.
3. **One migration per dropped column** (incremental, testable). Don't drop them all at once.
4. **Participation questions keep their own copies** of these columns since they have no wrapper. Either branch the SQL or keep separate column ownership.

Recommended deferral: do this as a series of small PRs after Phase 2.4 + 3 land and the new code paths have been exercised on production for a couple of weeks. Risks include: broken share links (if `short_id` migration mishandles), broken creator authentication (if `creator_secret` removed prematurely), broken thread pages (if `follow_up_to` stops being populated on `questions`).

---

## Addressability paradigm (applies across all phases)

**The poll is the addressable unit. Sub-questions are internal-only.**

- **URLs reference polls, never questions.** Polls own `id` + `short_id` and are the targets of `/p/<short_id>/` and `/thread/<id>/`. Sub-question uuids exist for foreign-key plumbing inside the DB but are not URL-able. Any "share this", "copy link", "navigate to", or "related thread" computation routes through the poll, never a question uuid.
- **Poll-level state lives at the poll level — no client-side aggregation.** Voter participation list, total respondent count, "is this question closed", deadline, creator, follow-up/fork chain, vote-submission unit (Phase 3+), close/reopen/cutoff target — all these are poll-level concepts. They MUST be sourced from a poll-level endpoint or field on `PollResponse`. The FE never iterates `poll.questions` to compute poll-level state. If the data doesn't exist at the poll level today, the right fix is to surface it at that level (server field or new endpoint), not to aggregate on the client.
- **Per-question state still flows per-question.** Ballots, options, suggestions, time slots, ranking interactions, question results — all continue to use `/api/questions/<question-id>` endpoints. The paradigm is about POLL-LEVEL aggregates, not about deprecating question plumbing.
- **Internal client identifiers can still use question ids freely.** Refs, cache keys, DOM `key=` props, expand state — these are not URLs and not API contracts. Sub-question ids work fine here.

When designing any feature in this rollout, ask: *"is this a poll-level concept?"* If yes → route through a poll endpoint/field. Never sum/dedupe across questions in the browser.

## Schema strategy (applies across phases)

Rather than introduce a new `questions` table that duplicates `questions`, we treat the existing `questions` table as **the question table** and add a new `polls` table for the wrapper-level fields. Each row in `questions` gains an `poll_id` FK pointing to its wrapper. A wrapper with one question renders identically to today's single-question view (the wrapper is invisible).

### Wrapper-level fields (move to `polls`)

These currently live on `questions` and apply to the whole poll, not any one question:

| Column | Notes |
|---|---|
| `id` (uuid, pk) | New uuid. Not the same as any question id. |
| `short_id` (text, unique) | Moves off `questions`. URL targets the poll, not a question. |
| `creator_secret` (uuid) | One secret for the whole poll. |
| `creator_name` (text, nullable) | |
| `response_deadline` (timestamptz) | The voting cutoff. |
| `prephase_deadline` (timestamptz, nullable) | Shared suggestion/availability cutoff. |
| `prephase_deadline_minutes` (int, nullable) | For deferred prephase timing (mirrors current `suggestion_deadline_minutes`). |
| `is_closed` (bool) | |
| `close_reason` (text, nullable) | `'manual' \| 'deadline' \| 'max_capacity' \| 'uncontested'`. |
| `follow_up_to` (uuid → polls.id, nullable) | Threads = chains of polls. |
| `fork_of` (uuid → polls.id, nullable) | |
| `thread_title` (text, nullable) | User override; inherited from `follow_up_to`'s `thread_title` via the same `COALESCE` insert pattern as today. |
| `context` (text, nullable) | Optional whole-poll context (replaces today's `details` for the wrapper level). |
| `created_at` / `updated_at` | |

### Sub-question-level fields (stay on `questions`)

These are per-question and never need to be lifted to the wrapper:

| Column | Notes |
|---|---|
| `id`, `question_type`, `category`, `options`, `options_metadata` | |
| `details` | Per-question context label (e.g. disambiguating two `Where` questions). |
| `poll_id` (uuid → polls.id) | New, NOT NULL after Phase 4. Nullable during the dual-mode phases so legacy single questions still work. |
| `question_index` (int) | Display order within the poll. |
| Type-specific fields | `suggestion_deadline_minutes`, `min_availability_percent`, time-question fields, etc. The `suggestion_deadline` *value* moves to the poll level (shared); the *minutes* stay per-question only because different question types may compute it differently — but in practice all prephase-bearing questions in a poll resolve to the same cutoff. **TBD in Phase 3:** whether `*_minutes` consolidates onto the poll. |

### Fields that get retired (later)

By Phase 5, the following can be dropped from `questions` because the poll owns them:
`short_id`, `creator_secret`, `creator_name`, `response_deadline`, `is_closed`, `close_reason`, `follow_up_to`, `fork_of`, `thread_title`, `suggestion_deadline`. Don't drop them earlier — old code paths still read them.

### Why participation questions are excluded

Per CLAUDE.md → "Participation Questions (Deprecated)", participation questions don't get wrapped. They keep their own row in `questions` with `poll_id = NULL` forever. Phase 4's backfill explicitly skips `question_type = 'participation'`.

---

## Phase 1 — Foundation (this phase)

**Goal**: stand up the `polls` table and the new API endpoints. No frontend changes. No migration of existing data. Existing single-question codepaths are untouched. The new API works end-to-end so Phase 2 can build a UI against it.

### What's in scope

1. **One up/down migration** (next number `092`):
   - Create `polls` table with the columns above. All wrapper-level fields are NULLABLE except `id`, `short_id`, `creator_secret`, `created_at`, `updated_at` to allow flexible test-data shapes. RLS policies match those on `questions` (anon read, anon write; row-level access via `creator_secret` for mutations).
   - Add `poll_id` (uuid, nullable, FK → polls.id ON DELETE CASCADE) and `question_index` (int, nullable) to `questions`. Both nullable in Phase 1 — existing questions have NULL.
   - Backfill is **out of scope** for this migration. Existing questions keep `poll_id IS NULL`.
   - Down migration: drop the FK and the new columns from `questions`, drop `polls`. Pure additive — fully reversible.
2. **Pydantic models** (`server/models.py`):
   - `CreatePollRequest` — wrapper fields + `questions: list[CreateQuestionRequest]` (1+).
   - `CreateQuestionRequest` — every per-question field from the existing `CreateQuestionRequest` *except* the wrapper-level ones, plus optional per-question `context`.
   - `PollResponse` — wrapper fields + `questions: list[QuestionResponse]`.
3. **Endpoints** (`server/routers/questions.py` or a new `server/routers/polls.py`):
   - `POST /api/polls` — creates one poll row + N question rows in a single transaction. Returns the `PollResponse` plus the existing per-question `QuestionResponse` shape so the frontend can keep using the existing read paths.
   - `GET /api/polls/{short_id}` — returns the poll wrapper + questions, ordered by `question_index`.
   - `GET /api/polls/by-id/{poll_id}` — same as above by uuid.
   - **Auto-title**: `POST /api/polls` accepts an optional `title` and, when absent, computes one from `(question.category for question in questions)` joined in title case (algorithm: see "Auto-title rules" below). Persisted to `polls.thread_title` only when explicitly provided; otherwise re-computed at read time so re-arranging questions re-titles for free. **No new `polls.title` column.** The thread card already auto-titles from participants + thread_title; polls extend that with category-based titles.
   - **Validation**:
     - At least 1 question.
     - At most one question of `question_type = 'time'` (a single shared availability phase has only one time question).
     - Multiple questions of the same kind require distinct `context` strings.
     - **Reject** `question_type = 'participation'` questions — poll system excludes them.
     - `prephase_deadline < response_deadline` when both are set.
4. **Tests** (`server/tests/`):
   - Unit: title generator, question validators, transaction rollback on bad question input.
   - Integration: create single-question poll → `GET` returns it; create 3-question poll (e.g. one What, one When, one Where) → `GET` returns all 3 in order; create-with-bad-input rolls back atomically (no orphan questions).
   - **No coverage of voting, results, or thread aggregation in Phase 1.** Each question inherits the existing single-question vote/results endpoints unchanged.
5. **No frontend changes.** `lib/api.ts` may add `apiCreatePoll` / `apiGetPoll` helpers if convenient, but no component or page uses them yet.

### Auto-title rules

Pure function `generate_poll_title(questions, poll_context) -> str`. Lives in `server/algorithms/poll_title.py` so it can be unit-tested.

- Input: ordered list of question category strings (e.g. `["restaurant", "time"]`) + optional poll-level context (e.g. `"Birthday"`).
- Output rules (deterministic, locked here so frontend Phase 2 can mirror them):
  - 1 question, no context → use the question's existing single-question auto-title (`"Restaurant?"`, `"Time?"`, etc.).
  - 1 question + context → `"<Category> for <Context>"` (e.g. `"Restaurant for Birthday"`).
  - 2+ questions, no context → `"<A> and <B>"` (2) or `"<A>, <B>, and <C>"` (3+), title-cased.
  - 2+ questions + context → above + ` for <Context>` (e.g. `"Restaurant and Time for Birthday"`).
- Categories are mapped to titlecase display labels via the same lookup the frontend already uses (TBD: extract `BUILT_IN_TYPES` labels from `components/TypeFieldInput.tsx` into a backend-shared JSON or duplicate). For Phase 1, hardcode the eight common labels (`yes/no`, `restaurant`, `location`, `time`, `movie`, `videogame`, `petname`, `custom`) and fall back to title-cased `category` string for unknowns.

### Out of scope for Phase 1

- Frontend What/When/Where buttons.
- Dual-modal create flow.
- Multi-question voting (single Submit, per-question abstain).
- Thread card aggregation (one card per poll instead of per question).
- Migration of existing questions.
- Moving `follow_up_to` / `fork_of` to polls.
- Any change to how votes, results, close/reopen, or threading work for legacy single questions.

### Risk / rollback

- All schema changes are additive. The down migration cleanly removes them.
- New endpoints are net-new; no existing route changes behavior.
- The whole phase can be reverted by `git revert` + running the down migration.

### Done criteria

- Migration `092` applied on dev + production droplets.
- `POST /api/polls` + `GET /api/polls/{short_id}` + `GET /api/polls/by-id/{id}` all green in `server/tests/`.
- A `curl` against the dev API can create a 3-question poll and read it back. Demo this in the PR description.
- Existing E2E suite still passes.

---

## Phase 2 — Frontend creation flow

**Goal**: users start creating polls via the new What/When/Where bubbles. New questions go through `POST /api/polls`. Old questions continue to render via the existing single-question codepath.

Phase 2 is too big to ship in one PR. It's split into five sub-phases, each shippable on its own. Sub-phases 2.1–2.3 are pure plumbing / single-button replacement; 2.4 introduces the dual-modal multi-question UI; 2.5 wires up rendering for multi-question polls.

The cardinal rule for every sub-phase: **legacy single questions keep working unchanged**. Mixed state (some questions have `poll_id`, some don't) is the norm through the rest of the rollout.

### Phase 2.1 — API client + types + cache plumbing (no UI change)

Smallest meaningful first step. Pure additive plumbing on the frontend:

- `lib/types.ts`: add `Poll` and `PollQuestion` interfaces matching `PollResponse` / `QuestionResponse` from the server.
- `lib/api.ts`: `apiCreatePoll`, `apiGetPollByShortId`, `apiGetPollById` helpers. Coalesce concurrent fetches via the existing `coalesced()` idiom. Cache results.
- `lib/questionCache.ts`: `pollCache` keyed by id and short_id. 60s TTL. `cachePoll`, `getCachedPollById`, `getCachedPollByShortId`, `invalidatePoll`. Sub-questions are cached via the existing `cacheQuestion()` since they're plain `Question` objects.
- No component or page changes. No new entry points exercise these helpers yet.

Done criteria: helpers exist, are typed, build cleanly. No behavior change visible to users. Can be exercised manually via browser devtools (`window.__apiCreatePoll = ...` for ad-hoc curl-like testing) or by writing a one-off test page.

### Phase 2.2 — Single-button "+" routes through `POST /api/polls` ✅

Switched the existing create-question flow to write polls under the hood — UI stays exactly the same (one big create form, one Submit button → one question wrapped in one poll).

- `app/create-question/page.tsx` submit handler: builds a `CreatePollRequest` with exactly one `CreateQuestionRequest` (`questionDataToPollRequest()`) and calls `apiCreatePoll`. Participation questions keep using `apiCreateQuestion`. On success navigate to `/p/<poll.short_id>/`.
- `app/p/[shortId]/page.tsx` loader: tries `apiGetPollByShortId` / `apiGetPollById` first; on 404 falls back to `apiGetQuestionByShortId` / `apiGetQuestionById`. For 1-question polls, the single question is fed into `ThreadContent` as `initialExpandedQuestionId` exactly like today. Cache lookups (`getCachedPoll*`) are tried synchronously first so warm hits render on first paint.
- `app/thread/[threadId]/page.tsx` and `lib/threadUtils.ts`: unchanged — they still walk the questions table. The questions row gets `follow_up_to` / `fork_of` written by `_insert_question`, so legacy thread aggregation finds the chain transparently.
- Server resolution: `CreatePollRequest.follow_up_to` / `fork_of` are QUESTION ids (matching the legacy single-question API). `_resolve_parent_poll_id` looks up the parent question's `poll_id` for the polls row; legacy parents resolve to `NULL`. `_insert_question` writes the original question_id onto each question's `questions.follow_up_to` / `questions.fork_of`. `_insert_poll` falls back to the legacy parent question's `thread_title` via a second `COALESCE` branch.
- `is_auto_title` is now part of `CreateQuestionRequest` so subsequent fork/duplicate flows preserve auto-title state.
- `next.config.ts` rewrites: `/api/polls`, `/api/polls/`, and `/api/polls/:path*` proxy to the backend so the FE same-origin fetches work.
- Six new server tests cover the chain propagation (followup→poll, followup→legacy, fork_of→poll, thread_title inheritance from both kinds of parent, explicit-title-wins).

Done: creating a question (regular, follow-up, fork, duplicate) writes a poll wrapper + 1 question. URL is the poll's short_id. Existing thread / question pages render the new question identically to before. Existing legacy questions (no `poll_id`) keep working.

### Phase 2.3 — What/When/Where FAB on home + thread (still single question)

Visual change to the FAB; behavior is equivalent to a category-prefilled tap of the old `+` button.

- Replace the single `+` floating action button (`app/template.tsx` portal target, `#floating-fab-portal`) with three equally-spaced bubble buttons: **What** / **When** / **Where**.
- Each bubble opens the existing create-question modal with the category preselected:
  - **What** → no preselection (user picks from dropdown excluding location/restaurant/time).
  - **When** → category locked to `time`.
  - **Where** → category dropdown limited to location-like categories (restaurant, location, custom).
- Empty thread placeholder (`/thread/new`) gets the same three bubbles instead of the old single `+`.
- No multi-question yet; the modal still creates exactly one question on submit.
- Update CLAUDE.md "Navigation Layout" to describe the three-bubble FAB.

Done criteria: home + thread + `/thread/new` show three bubbles. Each opens the create-question modal pre-set to the right category. Submit produces a 1-question poll.

### Phase 2.4 — Dual-modal multi-question create flow

The big UI change: the top sheet stages a single question, the bottom sheet holds shared poll fields, and the user can add multiple questions before submitting.

- Bottom modal (shared poll fields): optional `context`, voting cutoff (`response_deadline`), optional shared prephase cutoff (`prephase_deadline_minutes`). Slides up only as far as needed for its content.
- Top modal (per-question): category + options + optional per-question `context`. Has a checkmark in its top-right corner that commits the question to a draft slot.
- Draft slots: compact rows displayed above the bottom form showing each staged question's category + summary. The What/When/Where bubbles reappear above the bottom form between commits so the user can add more questions.
- localStorage draft persistence (per-tab, per-device): preserve draft state across modal close + reopen, browser refresh, etc.
- Submit calls `POST /api/polls` with all staged questions. On success → `/p/<poll.short_id>/`.
- Validation in the UI mirrors the server: ≥1 question, ≤1 time question, same-kind questions require distinct contexts, no participation questions.
- Auto-title preview in the bottom modal header (mirrors `generate_poll_title` logic).

Done criteria: user can create 2+ question polls. Reopening the modal mid-create preserves the draft. Server returns 201 and the URL navigates to a multi-question poll page (rendered in 2.5).

### Phase 2.5 — Render multi-question polls (read-only display, per-question voting) ✅

Sibling questions (sharing a `poll_id`) now join the thread automatically.

- `lib/threadUtils.ts`: `buildQuestionMaps` builds a `siblingsOf` map from `poll_id`. `collectDescendants` enqueues siblings when visiting a question. Sort breaks shared-`created_at` ties via `question_index` so questions render in the order the creator added them.
- `lib/types.ts`, `lib/api.ts`: `Question` carries `poll_id` + `question_index`; `toQuestion` maps both.
- `server/models.py`, `server/routers/questions.py`: `QuestionResponse` exposes both fields; `_row_to_question` maps from the DB.
- `server/algorithms/related_questions.py`, `server/routers/questions.py:/related`: discovery walks `poll_id` so visiting one question grants access to its siblings.
- `app/p/[shortId]/page.tsx` is unchanged: it still picks `poll.questions[0]` as the anchor for `findThreadRootRouteId`. With siblings now in the thread, that's enough — the rendered thread includes every question.

Single-question polls (the post-Phase-4 norm) are unaffected — `siblingsOf` has no entry for them, behavior is identical to the legacy follow_up_to walk.

Voting/results remain per-question. Each question's card still has its own Submit. Phase 3 unifies these.

The rendering DOES result in a few cosmetic quirks worth flagging for Phase 3 polish:
- All questions share the same auto-generated poll title (e.g. `"Yes/No and Restaurant for Birthday"`), so each card's title is identical. The per-question `context` IS displayed inside the card (it's the `details` field on the question), but the `<h3>` header still shows the wrapper title.
- The thread card respondent row + footer pill render per-question, not poll-aggregated.
- Long-press → close/reopen still hits per-question endpoints, so a "close poll" needs N taps for N questions.

These are intentionally deferred to Phase 3.

### Cross-cutting concerns for Phase 2

- **Cache invalidation**: every poll mutation (create, vote propagation, close — Phase 3) needs to call `invalidatePoll()` and `invalidateAccessibleQuestions()`. Phase 2 only has create, but lay the helper down in 2.1.
- **`questionDiscovery.ts`**: walks `follow_up_to` chains on questions. Once 2.2 propagates `follow_up_to` to the questions row for questions, discovery keeps working. If we later switch the source of truth to polls.follow_up_to, discovery needs an update.
- **PWA cache**: snapshot helpers (`buildQuestionSnapshot` in `lib/questionCreator.ts`) used for fork/duplicate/follow-up are unchanged through Phase 2 — they still operate on a single `Question`. Phase 2.4's draft persistence is a separate localStorage store.

### Open questions for Phase 2 (revisit during sub-phase implementation)

- How do Follow-Up / Fork / Duplicate compose with the new What/When/Where flow in 2.4? Likely: prefill a single What/When/Where draft slot matching the source's category, then the user can add more.
- Does 2.4's bottom modal show the "shared prephase cutoff" only when at least one staged question has a prephase? (Probably yes — yes/no-only polls don't need a prephase cutoff.)
- Should `apiGetPoll` also seed the per-question `questionCache` so subsequent `apiGetQuestionById` calls hit warm cache? (Probably yes — minor perf win, easy to do in the helper.)

---

## Phase 3 — Voting + poll-level operations unified

**Goal**: voting, results, close/reopen, follow-up/fork all operate at the poll level.

### Scope sketch

- Single `POST /api/polls/{id}/votes` accepts an array of `{question_id, ...vote payload}` plus a single `voter_name` and per-question `is_abstain`.
- The thread card displays one card per poll. Each question renders inside the card with its `context` label. There's one Submit at the bottom.
- Compact previews stack one per question inside the card footer row.
- `polls.is_closed` becomes the source of truth for "is this question open"; existing per-question `is_closed` continues to be written to keep legacy code working until Phase 5.
- Long-press modal (Forget / Reopen / Close / End Pre-Phase) targets the poll, not any single question.
- Poll-level `follow_up_to` and `fork_of` are introduced — the new bubble FAB on a thread page sets them.
- Cache layer updates: `questionCache.ts` adds a `pollCache` keyed by short_id; getAccessibleQuestions returns polls.

### Migration concern

By the end of Phase 3, two write paths exist for any given user action:
1. New questions (created in Phase 2+) live as polls; voting/closing operates at the poll level.
2. Old questions (created before Phase 2) live as standalone `questions` rows with no poll wrapper; voting/closing still uses the per-question endpoints.

The frontend needs to handle both. A simple way: if `question.poll_id` is set, use poll-level endpoints; else use legacy endpoints. The thread list and question page already deal with mixed state via `lib/threadUtils.ts`.

---

## Phase 4 — Backfill existing questions

**Goal**: every non-participation question has a poll wrapper. The legacy single-question codepath can be deleted.

### Scope sketch

- One-shot data migration (next available migration number, `093` or higher):
  - For every question with `poll_id IS NULL` and `question_type != 'participation'`:
    - Insert a poll row, copying wrapper-level fields from the question.
    - Set the question's `poll_id` to the new poll id, `question_index = 0`.
    - The poll's `short_id` adopts the question's `short_id`. The question's `short_id` is left in place but is no longer the URL target.
  - For every question with `follow_up_to` or `fork_of` set, look up the target question's new `poll_id` and write that into the new poll's `follow_up_to` / `fork_of`.
  - Wrap in a single transaction.
- `/p/<shortId>/` route resolves shortId → poll first, then falls back to question for the brief window before the migration runs in production.
- After successful production run, the frontend can drop the legacy fallback path.
- **Participation questions are deliberately untouched.** Their URL routing keeps working via the legacy single-question path; they remain `poll_id IS NULL` forever.

---

## Phase 5 — Cleanup

**Goal**: remove the columns and code paths the poll system no longer needs.

### Scope sketch

- Drop wrapper-level columns from `questions`: `short_id`, `creator_secret`, `creator_name`, `response_deadline`, `is_closed`, `close_reason`, `follow_up_to`, `fork_of`, `thread_title`. (Keep them on participation questions if those still exist — likely a partial drop with a `WHERE question_type != 'participation'` data clear before the column drop.)
- Delete legacy single-question API endpoints (`POST /api/questions`, `POST /api/questions/{id}/votes` per-question variants, etc.). Or keep them as thin shims for participation questions only.
- Delete frontend dual-codepath branches.
- Begin participation question phase-out as a separate sub-track (out of scope for this plan).

---

## How to start Phase 1

1. Create a new branch from `main` (e.g. `claude/multi-question-phase-1-schema-and-api`).
2. Write `database/migrations/092_create_polls_up.sql` and `_down.sql`.
3. Apply on the dev droplet via the standard migration command in CLAUDE.md.
4. Add Pydantic models + endpoints + tests in `server/`.
5. Push, wait for the dev server to come up, demo with a `curl` that creates a 3-question poll and reads it back. Share the dev URL in the PR.
6. PR title: `Phase 1: poll schema and creation API`.

The frontend is **deliberately untouched** — Phase 1 ends here.
