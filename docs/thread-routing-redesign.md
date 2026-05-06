# Thread Routing Redesign

> Status: Phase A shipped (#260), Phase B.1 shipped (#261), Phase B.2
> shipped (#262), Phase B.3 shipped (#263), Phase B.4 shipped (#264).
> Phase C.1 in progress (this branch); C.2 and C.3 deferred.

## Vision

Replace `/p/<shortId>` (which today does triple duty as thread anchor / specific-poll
deep-link / "id of any kind" resolver) with a clean URL split:

- `/t/<threadShortId>` — view a thread.
- `/t/<threadShortId>?p=<pollShortId>` — view a thread with one poll expanded and scrolled-to.
- `/p/<shortId>` — legacy alias; resolves and 302s to the canonical `/t/<root>?p=<shortId>`.

Long-term, the redesign also reshapes the data model so that **threads are first-class
entities with explicit per-user membership** keyed on join time. That unlocks server-driven
visibility (the user's join point determines what they can see), removes client-side chain
walking, and dramatically reduces the data the home page needs to fetch.

## Visibility rule (Phase C target)

A poll `P` in thread `T` is visible to user `U` iff **either**:

1. `U` is a member of `T` AND (`P.is_closed = false` OR `P.closed_at >= U.joined_at`), **or**
2. `U` has explicit per-poll access to `P` (came in via a direct link to that poll).

Direct-link access does **not** transitively grant thread membership — you can have one
poll pinned without joining the thread.

## Data model (Phase B+)

```
threads(id uuid PK, short_id text UNIQUE, created_at timestamptz)
polls(..., thread_id uuid FK)            -- replaces polls.follow_up_to chain walking
thread_members(thread_id, browser_id, joined_at)   -- composite PK
poll_access(poll_id, browser_id, granted_at)       -- composite PK
```

A single `browser_id` cookie identifies the browser (assigned on first visit, mirrored
into localStorage for resilience, replaces today's ad-hoc localStorage IDs +
creator_secret-keyed identity).

Threads stop being a derived concept (today: walk `polls.follow_up_to` to a root, every
poll in that chain belongs to the thread). They become first-class: `polls.thread_id`
points at a `threads` row. "Polls in this thread, in order" is just
`SELECT * FROM polls WHERE thread_id = $1 ORDER BY created_at`.

## Phases

### Phase A — URL split (this branch)

Pure routing refactor, no backend or schema changes.

- New routes under `/t/`:
  - `/t/[threadShortId]/` — main thread view.
  - `/t/[threadShortId]/info/` — participant list sub-route.
  - `/t/[threadShortId]/edit-title/` — title editor sub-route.
  - `/t/` — empty placeholder (was `/p/`).
- New query param: `?p=<pollShortId>` indicates which poll to expand and scroll to.
  Absent → don't expand any poll, scroll to the bottom of the thread (draft-form area).
- Old routes become redirects:
  - `/p/<shortId>` resolves shortId to a thread root and 302s to `/t/<root>?p=<shortId>`.
  - `/p/<shortId>/info` and `/p/<shortId>/edit-title` resolve and 302 to the matching
    `/t/<root>/...` path.
  - `/p/` (empty) redirects to `/t/`.
- `threadShortId` continues to be the **root poll's short_id**. No new keyspace, no
  schema changes. Phase B will introduce a real `threads.short_id` and decouple the two.
- The brittle bits documented in CLAUDE.md disappear:
  - `?thread=1` query param (still emitted today, no longer consumed): removed.
  - `suppressExpand` heuristic ("user responded to all questions in linked poll → don't
    auto-expand"): removed. Replaced by the simple rule "`?p=` present → expand that poll;
    absent → don't expand."
  - The path-param resolution cascade (poll short_id → poll uuid → question uuid) inside
    `PollPageInner` collapses: the path param is always a poll short_id (the thread root).
  - `history.replaceState`-on-expand to fake URL swaps (today rewrites `/p/<old>` → `/p/<new>`):
    Phase A keeps something similar but rewrites only the `?p=` query string, never the path.

#### Files changed (Phase A)

Moved (`app/p/...` → `app/t/...`, with param renamed `shortId` → `threadShortId`):

- `app/p/page.tsx` → `app/t/page.tsx`
- `app/p/[shortId]/page.tsx` → `app/t/[threadShortId]/page.tsx`
- `app/p/[shortId]/ThreadCardItem.tsx` → `app/t/[threadShortId]/ThreadCardItem.tsx`
- `app/p/[shortId]/threadActionCopy.ts` → `app/t/[threadShortId]/threadActionCopy.ts`
- `app/p/[shortId]/info/page.tsx` → `app/t/[threadShortId]/info/page.tsx`
- `app/p/[shortId]/edit-title/page.tsx` → `app/t/[threadShortId]/edit-title/page.tsx`

Replaced with redirect stubs:

- `app/p/page.tsx`
- `app/p/[shortId]/page.tsx`
- `app/p/[shortId]/info/page.tsx`
- `app/p/[shortId]/edit-title/page.tsx`

Updated to construct/match `/t/...?p=...` URLs:

- `lib/questionId.ts` (`extractQuestionRouteId`, `isThreadRootView`).
- `lib/threadUtils.ts` (drop `THREAD_QUERY_PARAM`).
- `lib/questionBackTarget.ts` (back path uses `/t/...?p=...`).
- `app/template.tsx` (pathname checks, page-title resolver, FAB target).
- `components/ThreadList.tsx` (prefetch + click handlers).
- `components/FollowUpHeader.tsx`, `components/VoteOnItModal.tsx`, `components/ResponsiveScaling.tsx`.
- `app/create-poll/page.tsx` (post-submit redirects, duplicate redirect, body-attribute reads).
- `app/poll/page.tsx` (legacy `?id=` redirect).

### Phase B — Materialize threads server-side

Broken into four sub-phases so each is independently shippable.

#### Phase B.1 — Schema only (this branch)

- Add the `threads` table (`id uuid PK, short_id text UNIQUE, created_at`).
- Add `polls.thread_id uuid` FK (nullable in this phase to avoid a deploy race).
- Backfill: thread.id == root_poll.id; recursive CTE on `follow_up_to` populates
  `thread_id` on every poll in every chain. `threads.short_id` is copied from the
  root poll's short_id so URLs would resolve once Phase B.4 starts using it.
- Server `_insert_poll` now sets `thread_id` on every new poll: follow-ups inherit
  `parent.thread_id`; roots create a fresh `threads` row.
- New threads created post-migration have `short_id = NULL` until Phase B.4 mints
  them from a fresh keyspace. Nothing reads `threads.short_id` yet, so this is fine.
- Migration: `099_create_threads_{up,down}.sql`.

Phase B.1 leaves `main` shippable: no API/FE changes, no behavior change. The
schema is in place for Phases B.2 / B.4 to consume.

#### Phase B.2 — Use `thread_id` server-side (this branch)

- `algorithms/related_polls.py` is reduced to a thread-id-grouped dedup
  helper. The chain-walking logic is gone; the SQL in
  `routers/questions.py:get_related_questions` does an indexed
  `WHERE thread_id IN (...)` lookup in a single round-trip instead of
  fetching every threaded question and walking in Python.
- `_resolve_parent_poll_id` is unchanged — it's a single `WHERE id = $1`
  lookup that translates a question_id (the public `follow_up_to`
  contract on requests) into a poll_id, not a chain walk.
- Migration `100_tighten_polls_thread_id_not_null` makes the column
  NOT NULL after a final backfill pass. By the time this migration
  runs, the Phase B.1 code has been writing thread_id on every insert
  for at least one deploy cycle, so any remaining NULLs are
  pre-deploy stragglers (handled by the same recursive CTE migration
  099 used).
- No API contract changes.

#### Phase B.3 — `browser_id` header + thread endpoints (this branch)

- `BrowserIdMiddleware` mints a uuid4 on first visit and echoes it via the
  `X-Browser-Id` response header. The FE captures the value
  (`lib/browserIdentity.ts`) and persists to localStorage; subsequent
  requests carry the same id via the matching request header.
  - **Header, not cookie.** The FE talks to the API same-origin via
    Next.js rewrites in prod and direct host in dev/CI; cookies under
    either setup would require flipping CORS to credentialed mode which
    doesn't compose with `allow_origins=["*"]`. The header avoids the
    CORS minefield while giving Phase C the same identity guarantee.
  - **Captured but not enforced yet.** `request.state.browser_id` is
    populated for every request; the new endpoints don't gate on it.
    Phase C will add the membership table and start filtering visibility.
- New endpoints — `routers/threads.py`:
  - `POST /api/threads/mine` — body
    `{accessible_question_ids: list[str], include_results?: bool}`,
    returns `list[PollResponse]` (every poll in any thread containing one of
    the requested questions). Collapses the legacy
    `discoverRelatedQuestions + apiGetAccessibleQuestions` pair into one
    server round-trip — the server walks `polls.thread_id` once instead of
    the FE walking `follow_up_to` chains across two calls.
  - `GET /api/threads/by-route-id/{routeId}?include_results=...` — same
    shape for one thread, resolved by `routeId`. The resolver checks
    `threads.short_id` → `threads.id` → `polls.short_id` → `polls.id`
    in order. Phase B.4 will start writing fresh `threads.short_id`s
    that take priority over the root-poll-short_id fallback.
- The aggregation body of `POST /api/questions/accessible` was extracted to
  `services/threads.py: polls_for_poll_ids(conn, poll_ids, *, include_results)`
  so both the legacy endpoint and the new threads router build identical
  payloads from a list of poll_ids. The legacy endpoint is now a thin
  question_id → poll_id resolver wrapping the same helper.
- FE rewiring:
  - `lib/api/threads.ts`: `apiGetMyThreads(ids)`, `apiGetThreadByRouteId(routeId)`.
    Both return `Poll[]` and warm `cachePoll` + the per-question results
    cache like `apiGetAccessibleQuestions` does.
  - `lib/simpleQuestionQueries.ts: getMyThreads()` — drop-in replacement
    for `getAccessiblePolls() + discoverRelatedQuestions()`. Reads the
    accessible_question_ids from localStorage, calls `apiGetMyThreads`,
    persists newly-discovered question_ids back to localStorage (subject
    to the forgotten-list filter), invalidates the accessible cache when
    the set grew, and caches the result.
  - `app/page.tsx`, `app/t/[threadShortId]/page.tsx`, `lib/useThread.ts`:
    home page + thread page + cache-first hook all switched to the new
    endpoints. `discoverRelatedQuestions` is no longer called from any of
    them; the function still exists for the test stub but is dead code on
    the navigation path.
- `next.config.ts` rewrites `/api/threads`, `/api/threads/`, and
  `/api/threads/:path*` to the backend so client-side requests stay
  same-origin.

Phase B.3 leaves `main` shippable as well: no schema changes, no API
contract changes for existing endpoints, just new endpoints + a request
header. The legacy endpoints (`/api/questions/accessible`, `/api/questions/related`)
remain in place so any client running the previous JS bundle keeps working
through the rollout window.

#### Phase B.4 — Decouple `threads.short_id` keyspace (this branch)

- `threadShortId` is now `threads.short_id` rather than the root poll's
  short_id. Every `PollResponse` carries `thread_id` (uuid) and
  `thread_short_id` so the FE can build `/t/<thread.short_id>?p=<poll.short_id>`
  URLs in a single field read — no follow-up-chain walking, no extra
  round-trips.
- Fresh `threads.short_id`s are minted from a separate `~`-prefixed
  keyspace via the trigger `generate_thread_short_id` introduced by
  migration 101. The `~` is URL-safe (RFC 3986 unreserved) and not in the
  base62 alphabet, so it guarantees zero collision with existing
  `polls.short_id` values — including the values B.1 backfilled into
  `threads.short_id` for legacy chain roots.
- Migration 101 also adds `threads.sequential_id BIGSERIAL UNIQUE` (the
  number-space the trigger encodes) and backfills `~`-prefixed short_ids
  for any threads created in the B.1→B.4 window that left
  `threads.short_id = NULL`.
- Old `/p/<shortId>` redirects continue to work via server-side resolution
  (`resolve_thread_id_from_route_id` in `services/threads.py`); old
  `/t/<root-poll-short-id>` URLs continue to work because the same
  resolver looks up `threads.short_id` first, and B.1 backfilled exactly
  those values into the column.
- FE rewiring:
  - `lib/types.ts: Poll` gains `thread_id` + `thread_short_id` (both
    `string | null` for resilience against synthesized placeholder polls
    and pre-B.4 cached polls).
  - `lib/threadUtils.ts: getThreadRouteId`, `resolveThreadRootRouteId`,
    `findThreadRootRouteId`, `buildThreadSyncFromCache` all prefer
    `thread_short_id` and fall back to the legacy walk.
  - `lib/useThread.ts` skips the question-anchor lookup entirely — it
    just calls `apiGetThreadByRouteId(threadId)` (which handles every
    route id form server-side) and finds the chain root in the returned
    list.
  - `app/t/[threadShortId]/page.tsx: ThreadPageInner` does the same:
    one thread-endpoint call resolves the route, finds the root poll,
    and warms the accessible-questions list — replacing the prior
    per-poll `apiGetPollByShortId` call which couldn't resolve
    `~`-prefixed thread route ids.

### Phase C — Membership with join-time visibility

Broken into three sub-phases mirroring Phase B's pattern, so each is
independently shippable and behavior changes only land once the schema +
writes are in place.

#### Phase C.1 — Schema only (this branch)

- Add `thread_members(thread_id, browser_id, joined_at)` with composite
  PK `(thread_id, browser_id)` and `joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Add `poll_access(poll_id, browser_id, granted_at)` with composite PK
  `(poll_id, browser_id)` and `granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Both tables FK to `threads(id)` / `polls(id)` with `ON DELETE CASCADE`
  so dropping a thread/poll cleans up its membership/access rows.
- Both tables get a secondary index on `browser_id` for the "all
  threads/polls this browser belongs to" lookup that C.3's read endpoints
  will use.
- RLS enabled with public select/insert/delete policies, mirroring the
  pattern used by `threads`. The actual visibility / write authorization
  lives in application code (Phase C.3), not in RLS, since `browser_id`
  is captured by middleware and not exposed to Postgres roles.
- No application code reads or writes either table yet. Phase C.1 leaves
  `main` shippable: pure additive schema, no behavior change.
- Migration: `102_create_membership_tables_{up,down}.sql`.

Backfill of legacy votes/creates is **not** part of C.1. `browser_id`
was only captured starting in Phase B.3 (#263), so pre-B.3 votes/creates
have no `browser_id` to attach a membership row to. The current plan is
to lean on C.2's auto-join writes for any returning browser (they
re-establish membership the next time they vote in the thread), backed
by the existing localStorage `accessible_question_ids` list which the FE
will continue to consult during the transition. Settling on a final
backfill answer is a follow-up — see CLAUDE.md →
"FOLLOW-UP — Decide backfill strategy ...".

#### Phase C.2 — Auto-join writes (deferred)

- Insert `thread_members(thread_id, browser_id, joined_at = NOW())` on
  vote / abstain / poll-create. Idempotent via `ON CONFLICT DO NOTHING`
  on the composite PK.
- Insert `poll_access(poll_id, browser_id, granted_at = NOW())` on the
  redirect resolution path for legacy `/p/<id>` URLs and on the `?p=`
  query-param expansion in `/t/<thread>?p=<poll>` — i.e. anywhere a
  user lands on a *specific* poll without already being a thread member.
- No reads gated yet. C.2 is purely additive at the storage layer:
  `thread_members` / `poll_access` get populated by live traffic, but
  nothing yet filters reads by them.

#### Phase C.3 — Visibility enforcement (deferred)

- Apply the visibility rule (see "Visibility rule" above) in the read
  endpoints `POST /api/threads/mine` and `GET /api/threads/by-route-id/{routeId}`.
- Resolve the open semantic questions before shipping:
  - **Join trigger:** vote/create/abstain only (the C.2 default), or
    also auto-join on direct `/t/<id>` visit, or explicit join button?
  - **Non-member visiting `/t/<id>` (no `?p`):** 404? "Join this thread"
    prompt? Read-only stub of the most recent open polls?
  - **Forget vs leave:** does forget-of-last-accessible-poll auto-drop
    `thread_members`, or do we add an explicit "leave thread" action?

## Open questions

The thread-short_id-keyspace question was resolved in Phase B.4: fresh
thread short_ids minted from a `~`-prefixed namespace, with the legacy
root-poll-short_id values kept on the existing `threads` rows so old
`/t/<root>` URLs still resolve through the same `threads.short_id`
lookup as the new ones.

The Phase C semantic questions (join trigger, non-member /t visit,
forget vs leave) are now tracked under "Phase C.3 — Visibility
enforcement (deferred)" above and need to be settled before C.3 ships.

## Phase A simplifications worth keeping in mind

The current code carries a few pieces of complexity that exist purely because the URL
is overloaded. Phase A should remove them in lockstep with the URL split — they don't
belong in the new world even temporarily:

- The `?thread=1` query parameter (defined as `THREAD_QUERY_PARAM`, emitted by
  `ThreadList`, no longer consumed anywhere — pure cruft).
- The `suppressExpand` `useMemo` in `app/p/[shortId]/page.tsx` and the comments
  describing why refresh-after-vote needed the rule.
- The "shortId could be a poll short_id, a poll uuid, or a question uuid" cascade
  inside `PollPageInner`. The new `/t/<threadShortId>` is unambiguously a poll short_id
  (the thread root). The old `/p/<shortId>` redirect handler still has to resolve
  ambiguous ids, but only for the redirect path — the live page never needs to.
