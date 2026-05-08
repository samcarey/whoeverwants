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
-- creator-as-instant-member and direct-link-recipient-as-poll-only.

BEGIN;

DROP POLICY IF EXISTS "Allow public delete access on poll_access" ON poll_access;
DROP POLICY IF EXISTS "Allow public insert access on poll_access" ON poll_access;
DROP POLICY IF EXISTS "Allow public read access on poll_access" ON poll_access;
DROP INDEX IF EXISTS idx_poll_access_browser_id;
DROP TABLE IF EXISTS poll_access;

COMMIT;
