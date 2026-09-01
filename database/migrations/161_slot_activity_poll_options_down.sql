BEGIN;

ALTER TABLE slot_activities DROP COLUMN IF EXISTS poll_options;

COMMIT;
