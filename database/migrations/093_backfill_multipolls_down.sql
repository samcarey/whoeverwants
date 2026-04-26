-- Phase 4: down — reverse the multipoll backfill.
-- Migration: 093_backfill_multipolls_down
--
-- Strict inverse of the up migration. Identifies multipolls that share a
-- short_id with a poll whose multipoll_id matches — those are the rows
-- created by the backfill. Phase 2.2 multipolls (created via the new FE
-- create flow after #200) ALSO match this pattern (1:1 with a poll), so the
-- down migration removes them too. This is acceptable because Phase 4 is
-- conceptually one-way; the down exists for emergency rollback and any
-- multi-sub-poll multipolls (Phase 2.4+) are preserved by the join filter
-- below (they don't satisfy short_id equality with a single poll once
-- multiple polls share their multipoll_id... actually they DO via any one of
-- their sub-polls. Hence we explicitly filter to wrappers with exactly one
-- sub-poll).

BEGIN;

-- Find multipolls with exactly one sub-poll AND short_id == that sub-poll's
-- short_id. Those are the 1:1 wrappers (backfilled or Phase 2.2-created).
WITH single_wrappers AS (
  SELECT m.id AS multipoll_id, p.id AS poll_id
  FROM multipolls m
  JOIN polls p ON p.multipoll_id = m.id
  WHERE m.short_id = p.short_id
    AND (SELECT COUNT(*) FROM polls WHERE multipoll_id = m.id) = 1
)
UPDATE polls
SET multipoll_id = NULL,
    sub_poll_index = NULL
WHERE id IN (SELECT poll_id FROM single_wrappers);

-- Now delete the orphaned multipolls (no remaining sub-polls).
DELETE FROM multipolls m
WHERE NOT EXISTS (
  SELECT 1 FROM polls p WHERE p.multipoll_id = m.id
);

COMMIT;
