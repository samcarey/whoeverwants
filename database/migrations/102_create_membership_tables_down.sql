-- Down migration for 102_create_membership_tables.
-- Drops poll_access and thread_members. Safe because no application code
-- reads or writes either table in Phase C.1 — Phase C.2 wires the writes
-- and Phase C.3 wires the reads.

BEGIN;

DROP POLICY IF EXISTS "Allow public delete access on poll_access" ON poll_access;
DROP POLICY IF EXISTS "Allow public insert access on poll_access" ON poll_access;
DROP POLICY IF EXISTS "Allow public read access on poll_access" ON poll_access;
DROP INDEX IF EXISTS idx_poll_access_browser_id;
DROP TABLE IF EXISTS poll_access;

DROP POLICY IF EXISTS "Allow public delete access on thread_members" ON thread_members;
DROP POLICY IF EXISTS "Allow public insert access on thread_members" ON thread_members;
DROP POLICY IF EXISTS "Allow public read access on thread_members" ON thread_members;
DROP INDEX IF EXISTS idx_thread_members_browser_id;
DROP TABLE IF EXISTS thread_members;

COMMIT;
