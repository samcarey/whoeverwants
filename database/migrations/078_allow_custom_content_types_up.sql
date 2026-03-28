-- Allow arbitrary poll_content_type values (not just built-in types)
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_content_type_check;
ALTER TABLE polls ALTER COLUMN poll_content_type TYPE VARCHAR(50);
