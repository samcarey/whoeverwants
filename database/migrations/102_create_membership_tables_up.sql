-- Phase C.1 of the thread routing redesign.
-- Migration: 102_create_membership_tables
--
-- Materializes the per-browser membership tables that Phase C will use to
-- enforce join-time visibility (see docs/thread-routing-redesign.md →
-- "Visibility rule (Phase C target)"):
--
--   * thread_members(thread_id, browser_id, joined_at) — a browser is a
--     member of a thread once it has voted/abstained/created in any poll in
--     that thread. Membership grants visibility to every poll in the thread
--     except those closed before joined_at.
--   * poll_access(poll_id, browser_id, granted_at) — a browser has explicit
--     per-poll access from following a direct link to that poll. Direct-link
--     access does NOT transitively grant thread membership.
--
-- Phase C.1 stops at schema. Nothing in the app reads or writes either
-- table yet:
--   * C.2 will start writing thread_members + poll_access on
--     vote/create/abstain (the auto-join writes), and from `?p=<poll>` and
--     legacy /p/<id> redirect resolutions (the direct-link grants).
--   * C.3 will gate visibility in the read endpoints (POST /api/threads/mine
--     and GET /api/threads/by-route-id/{routeId}) on the union of the two
--     tables.
--
-- Backfill of legacy votes/creates is deferred. browser_id was only captured
-- starting in Phase B.3 (PR #263), so pre-B.3 votes/creates have no
-- browser_id to attach a membership row to. The current plan is to lean on
-- C.2's auto-join writes for any returning browser (they'll re-establish
-- membership the next time they vote in the thread), backed by the existing
-- localStorage `accessible_question_ids` list which the FE will continue to
-- consult during the transition. Settling on a final answer here is a
-- follow-up — see CLAUDE.md → "FOLLOW-UP — Decide backfill strategy ...".

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. thread_members
-- ---------------------------------------------------------------------------
--
-- Composite primary key (thread_id, browser_id) — a browser can only be a
-- member of a given thread once. joined_at is the moment they earned
-- membership; visibility filters compare poll closure timestamps against it.
--
-- Index on (browser_id) supports the "all threads I'm a member of" lookup
-- that POST /api/threads/mine will use in Phase C.3.

CREATE TABLE IF NOT EXISTS thread_members (
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  browser_id UUID NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, browser_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_members_browser_id
  ON thread_members(browser_id);

ALTER TABLE thread_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on thread_members" ON thread_members;
CREATE POLICY "Allow public read access on thread_members" ON thread_members
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert access on thread_members" ON thread_members;
CREATE POLICY "Allow public insert access on thread_members" ON thread_members
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete access on thread_members" ON thread_members;
CREATE POLICY "Allow public delete access on thread_members" ON thread_members
  FOR DELETE USING (true);

-- ---------------------------------------------------------------------------
-- 2. poll_access
-- ---------------------------------------------------------------------------
--
-- Composite primary key (poll_id, browser_id). granted_at is when the
-- browser first received the access grant. Direct-link access lets a user
-- view ONE poll without joining the thread — useful for cases like "someone
-- shared one specific poll's link with me, but I'm not part of the broader
-- thread".
--
-- Index on (browser_id) supports the "all polls I have direct access to"
-- lookup the read endpoints will use in Phase C.3.

CREATE TABLE IF NOT EXISTS poll_access (
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  browser_id UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, browser_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_access_browser_id
  ON poll_access(browser_id);

ALTER TABLE poll_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on poll_access" ON poll_access;
CREATE POLICY "Allow public read access on poll_access" ON poll_access
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert access on poll_access" ON poll_access;
CREATE POLICY "Allow public insert access on poll_access" ON poll_access
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete access on poll_access" ON poll_access;
CREATE POLICY "Allow public delete access on poll_access" ON poll_access
  FOR DELETE USING (true);

COMMIT;
