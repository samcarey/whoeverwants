-- Remove poll_content_type column from polls table
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_content_type_check;
ALTER TABLE polls DROP COLUMN IF EXISTS poll_content_type;
