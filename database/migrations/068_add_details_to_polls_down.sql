-- Remove details field from polls
ALTER TABLE polls DROP COLUMN IF EXISTS details;
