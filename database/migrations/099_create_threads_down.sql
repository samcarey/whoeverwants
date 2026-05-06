-- Down migration for 099_create_threads.
-- Drops polls.thread_id and the threads table. Safe because no application
-- code reads polls.thread_id in Phase B.1 — it's set by writes but never read
-- (Phase B.2 wires the reads).

BEGIN;

DROP INDEX IF EXISTS idx_polls_thread_id;
ALTER TABLE polls DROP COLUMN IF EXISTS thread_id;

DROP POLICY IF EXISTS "Allow public update access on threads" ON threads;
DROP POLICY IF EXISTS "Allow public insert access on threads" ON threads;
DROP POLICY IF EXISTS "Allow public read access on threads" ON threads;

DROP INDEX IF EXISTS idx_threads_short_id;
DROP TABLE IF EXISTS threads;

COMMIT;
