BEGIN;

DROP INDEX IF EXISTS group_invites_group_id_idx;
DROP TABLE IF EXISTS group_invites;

COMMIT;
