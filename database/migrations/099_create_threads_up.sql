-- Phase B.1 of the thread routing redesign.
-- Migration: 099_create_threads
--
-- Materializes threads as a first-class table. Until now, threads were a
-- derived concept: walk `polls.follow_up_to` to find the chain root, and
-- every poll in that chain belongs to the thread. After this migration,
-- each poll carries a `thread_id` FK pointing at the `threads` row that
-- owns it.
--
-- Phase B.1 stops here: the schema is in place but neither the API nor the
-- FE consume `thread_id` yet. Phase B.2 swaps server-side chain walking for
-- `WHERE thread_id = $1` lookups; Phase B.3 introduces the `browser_id`
-- cookie and new endpoints; Phase B.4 mints fresh `threads.short_id`s and
-- decouples the keyspace from `polls.short_id`.
--
-- See docs/thread-routing-redesign.md for the full plan.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. threads table
-- ---------------------------------------------------------------------------
--
-- short_id is nullable in Phase B.1: backfilled from the chain-root poll's
-- short_id for existing threads (so /t/<root-poll-short-id> URLs from Phase A
-- continue to resolve once Phase B.4 starts using thread.short_id), and left
-- NULL for new threads created after this migration. UNIQUE allows multiple
-- NULLs by default in PostgreSQL.

CREATE TABLE IF NOT EXISTS threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  short_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_short_id ON threads(short_id);

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on threads" ON threads;
CREATE POLICY "Allow public read access on threads" ON threads
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert access on threads" ON threads;
CREATE POLICY "Allow public insert access on threads" ON threads
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access on threads" ON threads;
CREATE POLICY "Allow public update access on threads" ON threads
  FOR UPDATE USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. polls.thread_id FK (nullable in Phase B.1)
-- ---------------------------------------------------------------------------
--
-- We don't tighten to NOT NULL yet — the prod deploy applies migrations BEFORE
-- the new code runs, so a brief window exists where the old code could insert
-- a poll without setting thread_id. A follow-up migration tightens the column
-- once the new code is fully rolled out.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS thread_id UUID
  REFERENCES threads(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_polls_thread_id ON polls(thread_id);

-- ---------------------------------------------------------------------------
-- 3. Backfill: one thread per existing chain root.
-- ---------------------------------------------------------------------------
--
-- We use thread.id == root_poll.id as a deterministic mapping. That makes the
-- recursive CTE update unambiguous (no JOIN on (created_at, short_id) which
-- can collide on freshly-built dev DBs that lack short_ids on legacy rows)
-- and keeps the down migration straightforward.

INSERT INTO threads (id, short_id, created_at)
SELECT p.id, p.short_id, p.created_at
  FROM polls p
 WHERE p.follow_up_to IS NULL
   AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.id = p.id);

WITH RECURSIVE chain AS (
  SELECT id, follow_up_to, id AS root_id
    FROM polls
   WHERE follow_up_to IS NULL
  UNION ALL
  SELECT p.id, p.follow_up_to, c.root_id
    FROM polls p
    JOIN chain c ON p.follow_up_to = c.id
)
UPDATE polls p
   SET thread_id = c.root_id
  FROM chain c
 WHERE p.id = c.id
   AND p.thread_id IS NULL;

COMMIT;
