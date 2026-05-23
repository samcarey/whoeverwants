BEGIN;

ALTER TABLE magic_link_tokens DROP COLUMN IF EXISTS user_id;

COMMIT;
