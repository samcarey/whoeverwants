-- Move thread_title from polls to threads, and drop polls.follow_up_to.
--
-- Two architectural cleanups in one migration:
--
-- 1) `polls.thread_title` was duplicated across every poll in a thread (with
--    COALESCE-inheritance on follow-up create + per-poll edits via
--    /api/polls/<id>/thread-title), which made earlier polls go stale after
--    a rename and gave us no single source of truth. The thread is the
--    natural owner of its name override.
--
-- 2) `polls.follow_up_to` was the legacy chain pointer. Phase B.1+ added a
--    first-class `threads` table with `polls.thread_id` so every poll
--    already knows its thread. The chain pointer is redundant for data
--    purposes — ordering within a thread is just `created_at`, the chain
--    root is just the oldest poll. Dropping it removes a whole tier of
--    walking infrastructure (FE: findThreadRootRouteId, collectDescendants,
--    buildPollMaps; BE: _resolve_parent_poll_id, _attach_poll_chain_fields,
--    QuestionResponse.poll_follow_up_to).
--
-- Backfill rule for threads.title: use the LATEST poll's thread_title
-- (highest created_at) since that's what the FE currently reads. A handful
-- of threads have divergent thread_title across polls (4 threads on the
-- dev DB at the time of this migration); the latest-wins rule matches the
-- FE's current display behavior.

-- 1) Add threads.title and backfill.
ALTER TABLE threads ADD COLUMN title TEXT;

UPDATE threads
SET title = sub.thread_title
FROM (
  SELECT DISTINCT ON (thread_id)
    thread_id, thread_title
  FROM polls
  WHERE thread_id IS NOT NULL
    AND thread_title IS NOT NULL
  ORDER BY thread_id, created_at DESC
) sub
WHERE threads.id = sub.thread_id;

-- 2) Drop polls.thread_title (consumers updated to read threads.title).
ALTER TABLE polls DROP COLUMN IF EXISTS thread_title;

-- 3) Drop polls.follow_up_to: FK first, then index, then column.
ALTER TABLE polls DROP CONSTRAINT IF EXISTS multipolls_follow_up_to_fkey;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_follow_up_to_fkey;
DROP INDEX IF EXISTS idx_polls_follow_up_to;
ALTER TABLE polls DROP COLUMN IF EXISTS follow_up_to;
