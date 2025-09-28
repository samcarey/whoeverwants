-- Add abstain column to votes table
ALTER TABLE votes ADD COLUMN IF NOT EXISTS is_abstain BOOLEAN DEFAULT false;

-- Create index for abstain queries
CREATE INDEX IF NOT EXISTS idx_votes_is_abstain ON votes(is_abstain);

-- Update RLS policy to allow abstain votes
DROP POLICY IF EXISTS "Users can insert their own votes" ON votes;
CREATE POLICY "Users can insert their own votes" ON votes
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their own votes" ON votes;
CREATE POLICY "Users can update their own votes" ON votes
  FOR UPDATE USING (true) WITH CHECK (true);