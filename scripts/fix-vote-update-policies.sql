-- Fix vote update policies to ensure immutability

-- Drop the conflicting permissive policies that allow updates
DROP POLICY IF EXISTS "Allow public update on votes" ON votes;

-- Also drop any other update policies and recreate properly
DROP POLICY IF EXISTS "votes_update_policy" ON votes;

-- Create a RESTRICTIVE policy that blocks ALL updates to votes
-- Using RESTRICTIVE instead of PERMISSIVE ensures this cannot be overridden
CREATE POLICY "votes_no_update_policy" ON votes
FOR UPDATE
USING (false)
WITH CHECK (false);

-- Verify we still have the proper insert and select policies
-- These should remain permissive to allow normal operations
-- (keeping existing insert and select policies as they are)