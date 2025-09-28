-- Add updated_at column to votes table to track vote edits
-- This is needed to properly handle nomination vote editing

-- Add updated_at column with default value
ALTER TABLE votes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing rows to have updated_at = created_at
UPDATE votes SET updated_at = created_at WHERE updated_at IS NULL;

-- Make updated_at NOT NULL after setting default values
ALTER TABLE votes ALTER COLUMN updated_at SET NOT NULL;

-- Create trigger to automatically update updated_at when votes are modified
DROP TRIGGER IF EXISTS update_votes_updated_at ON votes;
CREATE TRIGGER update_votes_updated_at
  BEFORE UPDATE ON votes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create index for efficient ordering by updated_at
CREATE INDEX IF NOT EXISTS votes_updated_at_idx ON votes(updated_at);