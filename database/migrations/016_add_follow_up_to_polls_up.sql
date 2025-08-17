-- Add follow_up_to column to polls table
-- This creates a parent-child relationship between polls

ALTER TABLE polls ADD COLUMN follow_up_to UUID REFERENCES polls(id);

-- Add index for efficient follow-up queries
CREATE INDEX idx_polls_follow_up_to ON polls(follow_up_to);

-- Add comment for documentation
COMMENT ON COLUMN polls.follow_up_to IS 'References the poll this is a follow-up to, creating poll chains';