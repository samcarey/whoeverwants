BEGIN;
DROP TABLE IF EXISTS contact_group_members;
DROP TABLE IF EXISTS contact_groups;
DROP TABLE IF EXISTS user_blocks;
DROP TABLE IF EXISTS friend_requests;
DROP INDEX IF EXISTS users_friend_code_uidx;
ALTER TABLE users DROP COLUMN IF EXISTS friend_code;
COMMIT;
