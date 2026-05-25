BEGIN;

ALTER TABLE users DROP COLUMN IF EXISTS recovery_reminder_dismissed;

COMMIT;
