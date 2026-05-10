# Group Routing Redesign

> Status: Phase A shipped (#260), Phase B.1 shipped (#261), Phase B.2
> shipped (#262), Phase B.3 shipped (#263), Phase B.4 shipped (#264),
> Phase C.1 shipped (#265), Phase C.2 shipped (#266), Phase C.3 shipped
> (#267). Follow-up "leave group" endpoint
> (`DELETE /api/groups/{id}/membership`) in progress on this branch.

## Vision

Replace `/p/<shortId>` (which today does triple duty as group anchor / specific-poll
deep-link / "id of any kind" resolver) with a clean URL split:

- `/g/<groupShortId>` — view a group.
- `/g/<groupShortId>?p=<pollShortId>` — view a group with one poll expanded and scrolled-to.
- `/p/<shortId>` — legacy alias; resolves and 302s to the canonical `/g/<root>?p=<shortId>`.

Long-term, the redesign also reshapes the data model so that **groups are first-class
entities with explicit per-user membership** keyed on join time. That unlocks server-driven
visibility (the user's join point determines what they can see), removes client-side chain
walking, and dramatically reduces the data the home page needs to fetch.

## Visibility rule (Phase C target)

A poll `P` in group `T` is visible to user `U` iff **either**:

1. `U` is a member of `T` AND (`P.is_closed = false` OR `P.closed_at >= U.joined_at`), **or**
2. `U` has explicit per-poll access to `P` (came in via a direct link to that poll).

Direct-link access does **not** transitively grant group membership — you can have one
poll pinned without joining the group.

## Data model (Phase B+)

```
groups(id uuid PK, short_id text UNIQUE, created_at timestamptz)
polls(..., group_id uuid FK)            -- replaces polls.follow_up_to chain walking
group_members(group_id, browser_id, joined_at)   -- composite PK
poll_access(poll_id, browser_id, granted_at)       -- composite PK
```

A single `browser_id` cookie identifies the browser (assigned on first visit, mirrored
into localStorage for resilience, replaces today's ad-hoc localStorage IDs +
creator_secret-keyed identity).

Groups stop being a derived concept (today: walk `polls.follow_up_to` to a root, every
poll in that chain belongs to the group). They become first-class: `polls.group_id`
points at a `groups` row. "Polls in this group, in order" is just
`SELECT * FROM polls WHERE group_id = $1 ORDER BY created_at`.

## Phases

### Phase A — URL split (this branch)

Pure routing refactor, no backend or schema changes.

- New routes under `/g/`:
  - `/g/[groupShortId]/` — main group view.
  - `/g/[groupShortId]/info/` — participant list sub-route.
  - `/g/[groupShortId]/edit-title/` — title editor sub-route.
  - `/g/` — empty placeholder (was `/p/`).
- New query param: `?p=<pollShortId>` indicates which poll to expand and scroll to.
  Absent → don't expand any poll, scroll to the bottom of the group (draft-form area).
- Old routes become redirects:
  - `/p/<shortId>` resolves shortId to a group root and 302s to `/g/<root>?p=<shortId>`.
  - `/p/<shortId>/info` and `/p/<shortId>/edit-title` resolve and 302 to the matching
    `/g/<root>/...` path.
  - `/p/` (empty) redirects to `/g/`.
- `groupShortId` continues to be the **root poll's short_id**. No new keyspace, no
  schema changes. Phase B will introduce a real `groups.short_id` and decouple the two.
- The brittle bits documented in CLAUDE.md disappear:
  - `?group=1` query param (still emitted today, no longer consumed): removed.
  - `suppressExpand` heuristic ("user responded to all questions in linked poll → don't
    auto-expand"): removed. Replaced by the simple rule "`?p=` present → expand that poll;
    absent → don't expand."
  - The path-param resolution cascade (poll short_id → poll uuid → question uuid) inside
    `PollPageInner` collapses: the path param is always a poll short_id (the group root).
  - `history.replaceState`-on-expand to fake URL swaps (today rewrites `/p/<old>` → `/p/<new>`):
    Phase A keeps something similar but rewrites only the `?p=` query string, never the path.

#### Files changed (Phase A)

Moved (`app/p/...` → `app/g/...`, with param renamed `shortId` → `groupShortId`):

- `app/p/page.tsx` → `app/g/page.tsx`
- `app/p/[shortId]/page.tsx` → `app/g/[groupShortId]/page.tsx`
- `app/p/[shortId]/GroupCardItem.tsx` → `app/g/[groupShortId]/GroupCardItem.tsx`
- `app/p/[shortId]/groupActionCopy.ts` → `app/g/[groupShortId]/groupActionCopy.ts`
- `app/p/[shortId]/info/page.tsx` → `app/g/[groupShortId]/info/page.tsx`
- `app/p/[shortId]/edit-title/page.tsx` → `app/g/[groupShortId]/edit-title/page.tsx`

Replaced with redirect stubs:

- `app/p/page.tsx`
- `app/p/[shortId]/page.tsx`
- `app/p/[shortId]/info/page.tsx`
- `app/p/[shortId]/edit-title/page.tsx`

Updated to construct/match `/g/...?p=...` URLs:

- `lib/questionId.ts` (`extractQuestionRouteId`, `isGroupRootView`).
- `lib/groupUtils.ts` (drop `GROUP_QUERY_PARAM`).
- `lib/questionBackTarget.ts` (back path uses `/g/...?p=...`).
- `app/template.tsx` (pathname checks, page-title resolver, FAB target).
- `components/GroupList.tsx` (prefetch + click handlers).
- `components/FollowUpHeader.tsx`, `components/VoteOnItModal.tsx`, `components/ResponsiveScaling.tsx`.
- `app/create-poll/page.tsx` (post-submit redirects, duplicate redirect, body-attribute reads).
- `app/poll/page.tsx` (legacy `?id=` redirect).

### Phase B — Materialize groups server-side

Broken into four sub-phases so each is independently shippable.

#### Phase B.1 — Schema only (this branch)

- Add the `groups` table (`id uuid PK, short_id text UNIQUE, created_at`).
- Add `polls.group_id uuid` FK (nullable in this phase to avoid a deploy race).
- Backfill: group.id == root_poll.id; recursive CTE on `follow_up_to` populates
  `group_id` on every poll in every chain. `groups.short_id` is copied from the
  root poll's short_id so URLs would resolve once Phase B.4 starts using it.
- Server `_insert_poll` now sets `group_id` on every new poll: follow-ups inherit
  `parent.group_id`; roots create a fresh `groups` row.
- New groups created post-migration have `short_id = NULL` until Phase B.4 mints
  them from a fresh keyspace. Nothing reads `groups.short_id` yet, so this is fine.
- Migration: `099_create_groups_{up,down}.sql`.

Phase B.1 leaves `main` shippable: no API/FE changes, no behavior change. The
schema is in place for Phases B.2 / B.4 to consume.

#### Phase B.2 — Use `group_id` server-side (this branch)

- `algorithms/related_polls.py` is reduced to a group-id-grouped dedup
  helper. The chain-walking logic is gone; the SQL in
  `routers/questions.py:get_related_questions` does an indexed
  `WHERE group_id IN (...)` lookup in a single round-trip instead of
  fetching every grouped question and walking in Python.
- `_resolve_parent_poll_id` is unchanged — it's a single `WHERE id = $1`
  lookup that translates a question_id (the public `follow_up_to`
  contract on requests) into a poll_id, not a chain walk.
- Migration `100_tighten_polls_group_id_not_null` makes the column
  NOT NULL after a final backfill pass. By the time this migration
  runs, the Phase B.1 code has been writing group_id on every insert
  for at least one deploy cycle, so any remaining NULLs are
  pre-deploy stragglers (handled by the same recursive CTE migration
  099 used).
- No API contract changes.

#### Phase B.3 — `browser_id` header + group endpoints (this branch)

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
- New endpoints — `routers/groups.py`:
  - `POST /api/groups/mine` — body
    `{accessible_question_ids: list[str], include_results?: bool}`,
    returns `list[PollResponse]` (every poll in any group containing one of
    the requested questions). Collapses the legacy
    `discoverRelatedQuestions + apiGetAccessibleQuestions` pair into one
    server round-trip — the server walks `polls.group_id` once instead of
    the FE walking `follow_up_to` chains across two calls.
  - `GET /api/groups/by-route-id/{routeId}?include_results=...` — same
    shape for one group, resolved by `routeId`. The resolver checks
    `groups.short_id` → `groups.id` → `polls.short_id` → `polls.id`
    in order. Phase B.4 will start writing fresh `groups.short_id`s
    that take priority over the root-poll-short_id fallback.
- The aggregation body of `POST /api/questions/accessible` was extracted to
  `services/groups.py: polls_for_poll_ids(conn, poll_ids, *, include_results)`
  so both the legacy endpoint and the new groups router build identical
  payloads from a list of poll_ids. The legacy endpoint is now a thin
  question_id → poll_id resolver wrapping the same helper.
- FE rewiring:
  - `lib/api/groups.ts`: `apiGetMyGroups(ids)`, `apiGetGroupByRouteId(routeId)`.
    Both return `Poll[]` and warm `cachePoll` + the per-question results
    cache like `apiGetAccessibleQuestions` does.
  - `lib/simpleQuestionQueries.ts: getMyGroups()` — drop-in replacement
    for `getAccessiblePolls() + discoverRelatedQuestions()`. Reads the
    accessible_question_ids from localStorage, calls `apiGetMyGroups`,
    persists newly-discovered question_ids back to localStorage (subject
    to the forgotten-list filter), invalidates the accessible cache when
    the set grew, and caches the result.
  - `app/page.tsx`, `app/g/[groupShortId]/page.tsx`, `lib/useGroup.ts`:
    home page + group page + cache-first hook all switched to the new
    endpoints. `discoverRelatedQuestions` is no longer called from any of
    them; the function still exists for the test stub but is dead code on
    the navigation path.
- `next.config.ts` rewrites `/api/groups`, `/api/groups/`, and
  `/api/groups/:path*` to the backend so client-side requests stay
  same-origin.

Phase B.3 leaves `main` shippable as well: no schema changes, no API
contract changes for existing endpoints, just new endpoints + a request
header. The legacy endpoints (`/api/questions/accessible`, `/api/questions/related`)
remain in place so any client running the previous JS bundle keeps working
through the rollout window.

#### Phase B.4 — Decouple `groups.short_id` keyspace (this branch)

- `groupShortId` is now `groups.short_id` rather than the root poll's
  short_id. Every `PollResponse` carries `group_id` (uuid) and
  `group_short_id` so the FE can build `/g/<group.short_id>?p=<poll.short_id>`
  URLs in a single field read — no follow-up-chain walking, no extra
  round-trips.
- Fresh `groups.short_id`s are minted from a separate `~`-prefixed
  keyspace via the trigger `generate_group_short_id` introduced by
  migration 101. The `~` is URL-safe (RFC 3986 unreserved) and not in the
  base62 alphabet, so it guarantees zero collision with existing
  `polls.short_id` values — including the values B.1 backfilled into
  `groups.short_id` for legacy chain roots.
- Migration 101 also adds `groups.sequential_id BIGSERIAL UNIQUE` (the
  number-space the trigger encodes) and backfills `~`-prefixed short_ids
  for any groups created in the B.1→B.4 window that left
  `groups.short_id = NULL`.
- Old `/p/<shortId>` redirects continue to work via server-side resolution
  (`resolve_group_id_from_route_id` in `services/groups.py`); old
  `/g/<root-poll-short-id>` URLs continue to work because the same
  resolver looks up `groups.short_id` first, and B.1 backfilled exactly
  those values into the column.
- FE rewiring:
  - `lib/types.ts: Poll` gains `group_id` + `group_short_id` (both
    `string | null` for resilience against synthesized placeholder polls
    and pre-B.4 cached polls).
  - `lib/groupUtils.ts: getGroupRouteId`, `resolveGroupRootRouteId`,
    `findGroupRootRouteId`, `buildGroupSyncFromCache` all prefer
    `group_short_id` and fall back to the legacy walk.
  - `lib/useGroup.ts` skips the question-anchor lookup entirely — it
    just calls `apiGetGroupByRouteId(groupId)` (which handles every
    route id form server-side) and finds the chain root in the returned
    list.
  - `app/g/[groupShortId]/page.tsx: GroupPageInner` does the same:
    one group-endpoint call resolves the route, finds the root poll,
    and warms the accessible-questions list — replacing the prior
    per-poll `apiGetPollByShortId` call which couldn't resolve
    `~`-prefixed group route ids.

### Phase C — Membership with join-time visibility

Broken into three sub-phases mirroring Phase B's pattern, so each is
independently shippable and behavior changes only land once the schema +
writes are in place.

#### Phase C.1 — Schema only (this branch)

- Add `group_members(group_id, browser_id, joined_at)` with composite
  PK `(group_id, browser_id)` and `joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Add `poll_access(poll_id, browser_id, granted_at)` with composite PK
  `(poll_id, browser_id)` and `granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Both tables FK to `groups(id)` / `polls(id)` with `ON DELETE CASCADE`
  so dropping a group/poll cleans up its membership/access rows.
- Both tables get a secondary index on `browser_id` for the "all
  groups/polls this browser belongs to" lookup that C.3's read endpoints
  will use.
- RLS enabled with public select/insert/delete policies, mirroring the
  pattern used by `groups`. The actual visibility / write authorization
  lives in application code (Phase C.3), not in RLS, since `browser_id`
  is captured by middleware and not exposed to Postgres roles.
- No application code reads or writes either table yet. Phase C.1 leaves
  `main` shippable: pure additive schema, no behavior change.
- Migration: `102_create_membership_tables_{up,down}.sql`.

Backfill of legacy votes/creates is **not** part of C.1. `browser_id`
was only captured starting in Phase B.3 (#263), so pre-B.3 votes/creates
have no `browser_id` to attach a membership row to. The current plan is
to lean on C.2's auto-join writes for any returning browser (they
re-establish membership the next time they vote in the group), backed
by the existing localStorage `accessible_question_ids` list which the FE
will continue to consult during the transition. Settling on a final
backfill answer is a follow-up — see CLAUDE.md →
"FOLLOW-UP — Decide backfill strategy ...".

#### Phase C.2 — Auto-join writes (deferred)

- Insert `group_members(group_id, browser_id, joined_at = NOW())` on
  vote / abstain / poll-create. Idempotent via `ON CONFLICT DO NOTHING`
  on the composite PK.
- Insert `poll_access(poll_id, browser_id, granted_at = NOW())` on the
  redirect resolution path for legacy `/p/<id>` URLs and on the `?p=`
  query-param expansion in `/g/<group>?p=<poll>` — i.e. anywhere a
  user lands on a *specific* poll without already being a group member.
- No reads gated yet. C.2 is purely additive at the storage layer:
  `group_members` / `poll_access` get populated by live traffic, but
  nothing yet filters reads by them.

#### Phase C.3 — Visibility enforcement (this branch)

The visibility rule is enforced in the two read endpoints. A poll P in
group T is visible to browser B iff ANY of:

1. B has a `group_members` row for T AND
   (`P.is_closed = false` OR `P.closed_at >= members.joined_at`), OR
2. B has a `poll_access` row for P, OR
3. (transitional bridge) The legacy `accessible_question_ids` list
   passed by the FE contains a question_id whose poll lives in T.
   Treated as **group-level** access — every poll in T visible, no
   closed_at filter — so pre-B.3 callers passing one question_id keep
   seeing the whole group (the Phase B.3 contract). Per-poll bridging
   would silently shrink groups on first refresh post-rollout. Applies
   to `/api/groups/mine` only.

`closed_at` proxy: `polls.updated_at`, refreshed by the close trigger.
Subsequent edits to a closed poll bump `updated_at` forward, so the
filter fails open (a closed poll touched after the user joins becomes
visible). A dedicated column would be marginally tighter; deferred.

##### Decisions on the three previously-open semantic questions

- **Join trigger**: vote/create only — the Phase C.2 defaults are
  preserved. The `/access` endpoint and the `?p=` auto-grant on
  by-route-id grant `poll_access` (per-poll, not group membership), so
  `group_members` is exclusively driven by acts of participation.
- **Non-member visiting `/g/<id>` with no `?p`**: 404. We treat "no
  visibility into any poll of this group" the same as "no such group"
  for both UX simplicity and consistent FE error handling. The FE's
  existing "Group Not Found" UI handles both cases uniformly.
- **Forget vs leave**: forget stays localStorage-only. We do NOT delete
  `group_members` on forget; instead, when the FE passes
  `accessible_question_ids` we narrow `/api/groups/mine` to groups the
  user still has at least one non-membership signal in (poll_access OR
  legacy bridge). This preserves the "group disappears from the home
  list" UX during the rollout. An explicit `DELETE
  /api/groups/{id}/membership` is a follow-up so the bridge can
  eventually be retired.

##### `?p=` inline auto-grant on by-route-id

`GET /api/groups/by-route-id/{route_id}` accepts an optional
`?p=<pollShortId>`. When present, a `poll_access` row is written inline
for that poll BEFORE visibility filtering. This race-safely surfaces a
direct-link landing — without it, a stranger hitting
`/g/<group>?p=<poll>` on a fresh browser would see by-route-id 404
because the FE's parallel `apiGrantPollAccess` call hadn't yet landed.
The lookup is scoped to the resolved group, so a `?p` referencing a
poll in a different group is silently ignored — no cross-group
access leak.

##### Migration cost

Pre-B.3 voters who haven't re-voted have no `group_members` row. They
keep working via the legacy bridge so long as their FE passes
`accessible_question_ids`. Once they vote again, Phase C.2's auto-join
writes restore membership and they no longer rely on the bridge. The
bridge will be retired (and the home page narrowed to membership-only)
in a follow-up phase after enough rollout time has passed for inactive
browsers to cycle.

##### Out of scope for C.3

- Backfill of pre-B.3 votes into `group_members` (deferred — see
  "FOLLOW-UP — Decide backfill strategy ..." in CLAUDE.md).
- Explicit `DELETE /api/groups/{id}/membership` ("leave group")
  endpoint. Not strictly required during the rollout window because
  the forget bridge handles the equivalent UX for the legacy localStorage
  list.
- Visibility enforcement on the legacy `POST /api/questions/accessible`
  endpoint. The FE migrated to `/api/groups/*` in B.3 so it's a
  compatibility surface for older client bundles only; gating it
  retroactively would risk breaking those clients during the rollout.

## Open questions

The group-short_id-keyspace question was resolved in Phase B.4: fresh
group short_ids minted from a `~`-prefixed namespace, with the legacy
root-poll-short_id values kept on the existing `groups` rows so old
`/g/<root>` URLs still resolve through the same `groups.short_id`
lookup as the new ones.

The Phase C semantic questions (join trigger, non-member /g visit,
forget vs leave) were resolved in Phase C.3 — see decisions inline
under "Phase C.3 — Visibility enforcement" above.

Two follow-up items remain, neither blocking the redesign:

- **Backfill of pre-B.3 votes** into `group_members`. Currently
  handled implicitly by the legacy `accessible_question_ids` bridge in
  `/api/groups/mine`, plus the natural re-establishment on next vote
  via Phase C.2's auto-join writes. A one-time backfill would let us
  retire the bridge faster but isn't required for correctness.
- **Explicit `DELETE /api/groups/{id}/membership`** ("leave group")
  endpoint. The forget bridge replicates the UX during the rollout
  window. Adding the explicit action lets us retire the bridge — gates
  on the bridge becoming dead code first.

## Phase A simplifications worth keeping in mind

The current code carries a few pieces of complexity that exist purely because the URL
is overloaded. Phase A should remove them in lockstep with the URL split — they don't
belong in the new world even temporarily:

- The `?group=1` query parameter (defined as `GROUP_QUERY_PARAM`, emitted by
  `GroupList`, no longer consumed anywhere — pure cruft).
- The `suppressExpand` `useMemo` in `app/p/[shortId]/page.tsx` and the comments
  describing why refresh-after-vote needed the rule.
- The "shortId could be a poll short_id, a poll uuid, or a question uuid" cascade
  inside `PollPageInner`. The new `/g/<groupShortId>` is unambiguously a poll short_id
  (the group root). The old `/p/<shortId>` redirect handler still has to resolve
  ambiguous ids, but only for the redirect path — the live page never needs to.
