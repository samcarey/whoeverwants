-- Rename poll_type column to category
ALTER TABLE polls RENAME COLUMN poll_type TO category;

-- Rename the index
ALTER INDEX IF EXISTS idx_polls_poll_type RENAME TO idx_polls_category;
