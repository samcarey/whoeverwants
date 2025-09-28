-- Fix UPDATE policy for votes table to allow anonymous users to update their votes
-- This fixes the issue where vote edits fail due to missing UPDATE permissions

-- Drop existing problematic UPDATE policy if it exists
DROP POLICY IF EXISTS "Allow public update on votes" ON votes;

-- Create proper UPDATE policy for anonymous users
CREATE POLICY "Allow public update on votes" ON votes 
FOR UPDATE 
TO public 
USING (true)
WITH CHECK (true);

-- Verify RLS is enabled on votes table
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;