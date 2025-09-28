-- Fix RLS policy blocking vote updates
-- The current policy "votes_no_update_policy" has qual="false" which blocks ALL updates

-- Drop the blocking policy
DROP POLICY IF EXISTS "votes_no_update_policy" ON votes;

-- Create a proper update policy that allows updates
CREATE POLICY "Allow public update on votes" ON votes
FOR UPDATE TO public
USING (true)
WITH CHECK (true);

-- Ensure this policy takes precedence by dropping any conflicting policies
DROP POLICY IF EXISTS "Users can update their own votes" ON votes;
DROP POLICY IF EXISTS "Allow public update on votes" ON votes;

-- Recreate the update policy
CREATE POLICY "Allow public update on votes" ON votes
FOR UPDATE TO public
USING (true)
WITH CHECK (true);

COMMENT ON POLICY "Allow public update on votes" ON votes IS
'Allow anonymous users to update any vote for nomination editing functionality';