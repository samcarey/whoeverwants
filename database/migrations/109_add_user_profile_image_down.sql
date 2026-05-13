-- Rollback for 109_add_user_profile_image_up.sql

BEGIN;

DROP TABLE IF EXISTS user_profiles;

COMMIT;
