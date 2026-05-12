-- Rollback for 108_add_group_image_up.sql

BEGIN;

ALTER TABLE groups
  DROP COLUMN IF EXISTS image_updated_at,
  DROP COLUMN IF EXISTS image_mime_type,
  DROP COLUMN IF EXISTS image_data;

COMMIT;
