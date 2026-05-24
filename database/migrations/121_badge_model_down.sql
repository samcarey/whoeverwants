BEGIN;

ALTER TABLE poll_views DROP COLUMN IF EXISTS first_viewed_at;
ALTER TABLE users DROP COLUMN IF EXISTS badge_on_results;
ALTER TABLE users DROP COLUMN IF EXISTS badge_on_voting_open;
ALTER TABLE users DROP COLUMN IF EXISTS badge_todo_mode;

COMMIT;
