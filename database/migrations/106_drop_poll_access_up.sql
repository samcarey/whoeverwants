-- Migration: 106_drop_poll_access
--
-- Retires the `poll_access` table. Per-poll direct-link access is gone —
-- visiting any thread URL (`/t/<route_id>` with or without `?p=`) now
-- writes a `thread_members` row inline, granting whole-thread visibility
-- subject to the closed-before-join filter.
--
-- Rationale: per-poll access was a privacy feature ("share one poll
-- without exposing siblings") that turned out to confuse the model
-- without buying meaningful protection — anyone the URL leaks to was
-- always going to graduate to thread membership the moment they voted.
-- Collapsing to thread-only access removes the asymmetry between
-- creator-as-instant-member and direct-link-recipient-as-poll-only and
-- makes a single Share Thread button ergonomic at the UI level.
--
-- Companion app changes (same PR):
--   * services/threads.py drops `access_poll_ids` from UserVisibility
--     and the `poll_access` SELECT in load_user_visibility, and replaces
--     `grant_poll_access_inline` with `grant_thread_membership_inline`.
--   * routers/threads.py: GET /api/threads/by-route-id/{id} writes
--     thread_members inline on every visit (idempotent ON CONFLICT). The
--     `?p=` query param is still accepted by old clients but ignored
--     server-side.
--   * routers/polls.py: POST /api/polls/{id}/access endpoint deleted.
--   * lib/api/polls.ts: apiGrantPollAccess deleted.
--   * lib/api/threads.ts: pollShortId option removed from
--     apiGetThreadByRouteId.
--   * components/ThreadShareButton.tsx: new top-right action in
--     ThreadHeader's rightSlot, uses navigator.share with clipboard fallback.

BEGIN;

DROP POLICY IF EXISTS "Allow public delete access on poll_access" ON poll_access;
DROP POLICY IF EXISTS "Allow public insert access on poll_access" ON poll_access;
DROP POLICY IF EXISTS "Allow public read access on poll_access" ON poll_access;
DROP INDEX IF EXISTS idx_poll_access_browser_id;
DROP TABLE IF EXISTS poll_access;

COMMIT;
