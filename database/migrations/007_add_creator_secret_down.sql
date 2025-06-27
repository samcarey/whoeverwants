-- Remove creator_secret column from polls table
DROP INDEX IF EXISTS idx_polls_creator_secret;
ALTER TABLE polls DROP COLUMN IF EXISTS creator_secret;