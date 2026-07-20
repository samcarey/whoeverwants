BEGIN;

ALTER TABLE slot_activities DROP COLUMN IF EXISTS with_groups;
ALTER TABLE slot_activities DROP COLUMN IF EXISTS with_people;

COMMIT;
