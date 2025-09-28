-- Remove poll_type and options columns from polls table
-- Migration: 003_add_poll_type_and_options (rollback)

-- Drop indexes
DROP INDEX IF EXISTS idx_polls_options;
DROP INDEX IF EXISTS idx_polls_poll_type;

-- Drop constraints
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;

-- Drop columns
ALTER TABLE polls DROP COLUMN IF EXISTS options;
ALTER TABLE polls DROP COLUMN IF EXISTS poll_type;