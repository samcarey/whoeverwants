-- Remove public poll features and short_id system
-- All polls are now private by default

-- Drop the short_id column and related features
ALTER TABLE polls DROP COLUMN IF EXISTS short_id;
ALTER TABLE polls DROP COLUMN IF EXISTS sequential_id;

-- Drop the is_private column since all polls are private now
ALTER TABLE polls DROP COLUMN IF EXISTS is_private;

-- Drop any sequences related to sequential IDs
DROP SEQUENCE IF EXISTS polls_sequential_id_seq;

-- Drop any indexes on the removed columns
DROP INDEX IF EXISTS idx_polls_short_id;
DROP INDEX IF EXISTS idx_polls_sequential_id;

-- Drop triggers and functions that reference removed columns
DROP TRIGGER IF EXISTS trigger_generate_short_id ON polls;
DROP FUNCTION IF EXISTS generate_short_id();

-- Update the polls table comment
COMMENT ON TABLE polls IS 'All polls are private and accessible only via full UUID';

-- Verify the changes
SELECT 'Removed public poll features - all polls are now private' AS status;