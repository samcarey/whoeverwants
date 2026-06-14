BEGIN;

DROP INDEX IF EXISTS polls_variant_root_idx;

ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_variant_direction_check;

ALTER TABLE polls
  DROP COLUMN IF EXISTS variant_parent_id,
  DROP COLUMN IF EXISTS variant_root_id,
  DROP COLUMN IF EXISTS variant_direction,
  DROP COLUMN IF EXISTS variant_generation,
  DROP COLUMN IF EXISTS variant_spawned;

COMMIT;
