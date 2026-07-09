BEGIN;

DROP TABLE IF EXISTS poll_comment_reactions;
ALTER TABLE poll_comments DROP COLUMN IF EXISTS mentions;
ALTER TABLE poll_comments DROP COLUMN IF EXISTS edited_at;

COMMIT;
