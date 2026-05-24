-- Reverse migration 120. Drops the columns + table added by the up
-- migration. The is_closed backfill (step 4 of the up migration) is NOT
-- reversible — once a deadline-passed poll is flipped to is_closed=true we
-- can't tell it apart from a poll that was explicitly closed, so the down
-- leaves is_closed alone (matching the 118 prephase-backfill precedent).

BEGIN;

ALTER TABLE polls DROP COLUMN IF EXISTS prephase_notified;
ALTER TABLE polls DROP COLUMN IF EXISTS close_notified;

DROP TABLE IF EXISTS poll_views;

DROP INDEX IF EXISTS votes_browser_id_idx;
ALTER TABLE votes DROP COLUMN IF EXISTS browser_id;

COMMIT;
