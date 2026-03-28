-- Revert: rename category column back to poll_content_type
ALTER TABLE polls RENAME COLUMN category TO poll_content_type;
