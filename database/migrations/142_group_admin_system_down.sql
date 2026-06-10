-- Down-migration for 142.
--
-- NOTE: the destructive DELETE FROM groups WHERE creator_user_id IS NULL in the
-- up-migration CANNOT be reversed — those groups/polls/votes are gone. This
-- down only undoes the schema changes.

BEGIN;

ALTER TABLE group_members DROP COLUMN IF EXISTS joined_via_invite_id;
DROP TABLE IF EXISTS group_admins;

COMMIT;
