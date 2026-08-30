BEGIN;

DROP TABLE IF EXISTS slot_event_polls;
ALTER TABLE slot_activities DROP COLUMN IF EXISTS poll_draft;

COMMIT;
