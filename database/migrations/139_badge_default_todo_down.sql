-- Restore the unread-model default for badge_todo_mode (migration 121's value).
-- Cannot recover per-account choices overwritten by the up migration's UPDATE.

BEGIN;

ALTER TABLE users ALTER COLUMN badge_todo_mode SET DEFAULT FALSE;

COMMIT;
