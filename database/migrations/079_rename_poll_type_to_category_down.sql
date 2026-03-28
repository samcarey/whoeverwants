-- Revert: rename category column back to poll_type
ALTER TABLE polls RENAME COLUMN category TO poll_type;

-- Rename the index back
ALTER INDEX IF EXISTS idx_polls_category RENAME TO idx_polls_poll_type;
