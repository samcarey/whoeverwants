-- Add fork relationship to polls table
-- This allows polls to be marked as forks of other polls

ALTER TABLE polls ADD COLUMN IF NOT EXISTS fork_of UUID REFERENCES polls(id);

-- Add index for efficient fork queries
CREATE INDEX IF NOT EXISTS idx_polls_fork_of ON polls(fork_of);

-- Add comment explaining the column
COMMENT ON COLUMN polls.fork_of IS 'UUID of the poll this poll is forked from';