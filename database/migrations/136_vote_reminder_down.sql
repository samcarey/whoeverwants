BEGIN;

DROP TABLE IF EXISTS vote_reminders_sent;
ALTER TABLE users DROP COLUMN IF EXISTS vote_reminder;

COMMIT;
