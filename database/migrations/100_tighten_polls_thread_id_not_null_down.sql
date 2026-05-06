-- Down migration for 100_tighten_polls_thread_id_not_null.
-- Loosens the NOT NULL constraint on polls.thread_id. The data backfilled
-- by the up migration is left in place — that's a no-op for the schema and
-- safe to keep.

BEGIN;

ALTER TABLE polls ALTER COLUMN thread_id DROP NOT NULL;

COMMIT;
