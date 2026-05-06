-- Phase B.2 of the thread routing redesign.
-- Migration: 100_tighten_polls_thread_id_not_null
--
-- Phase B.1 (migration 099) added `polls.thread_id` as nullable to avoid a
-- deploy race: the migration runs before the new code, so old code briefly
-- inserts polls without setting thread_id. By the time this migration runs,
-- the new code (which always sets thread_id on every insert via
-- _resolve_or_create_thread_id) has fully rolled out, so any remaining NULLs
-- are pre-deploy stragglers. Backfill them with a recursive CTE on
-- follow_up_to (same approach as 099) and then tighten the column.
--
-- See docs/thread-routing-redesign.md for the full plan.

BEGIN;

-- Final backfill pass. Defensive: if 099 + the deploy already covered every
-- row, this is a no-op. The recursive CTE finds chain roots (or stops at the
-- first ancestor whose thread_id is set, even mid-chain).

INSERT INTO threads (id, short_id, created_at)
SELECT p.id, p.short_id, p.created_at
  FROM polls p
 WHERE p.follow_up_to IS NULL
   AND p.thread_id IS NULL
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

-- Any poll still missing a thread_id at this point is orphaned (its
-- follow_up_to references a deleted poll). Mint a fresh thread per orphan
-- so the NOT NULL constraint can land cleanly.

INSERT INTO threads (id, created_at)
SELECT p.id, p.created_at
  FROM polls p
 WHERE p.thread_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.id = p.id);

UPDATE polls p
   SET thread_id = p.id
 WHERE p.thread_id IS NULL;

ALTER TABLE polls ALTER COLUMN thread_id SET NOT NULL;

COMMIT;
