BEGIN;

ALTER TABLE slot_activities DROP COLUMN IF EXISTS min_people;
ALTER TABLE slot_activities DROP COLUMN IF EXISTS max_people;

COMMIT;
