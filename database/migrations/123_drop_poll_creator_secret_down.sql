-- Re-add the column (nullable). The original per-poll secret values are
-- unrecoverable — this only restores the column shape, not its data.
BEGIN;

ALTER TABLE polls ADD COLUMN IF NOT EXISTS creator_secret TEXT;

COMMIT;
