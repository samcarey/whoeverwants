-- Down migration for 101_mint_threads_short_id.

BEGIN;

DROP TRIGGER IF EXISTS trigger_generate_thread_short_id ON threads;
DROP FUNCTION IF EXISTS generate_thread_short_id();

-- Best-effort: restore short_id NULL for rows whose short_id has the `~`
-- prefix this migration introduces. Backfilled (B.1-era) short_ids without
-- the prefix are preserved so legacy /t/<root-poll-short-id> URLs keep
-- resolving on rollback.
UPDATE threads
   SET short_id = NULL
 WHERE short_id LIKE '~%';

ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_sequential_id_key;
ALTER TABLE threads DROP COLUMN IF EXISTS sequential_id;
DROP SEQUENCE IF EXISTS threads_sequential_id_seq;

COMMIT;
