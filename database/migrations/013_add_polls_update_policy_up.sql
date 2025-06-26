-- Add UPDATE policy for polls table to allow closing polls
-- Migration: 013_add_polls_update_policy
-- Description: Adds RLS policy to allow public UPDATE access on polls table (for closing polls)

-- Create policy to allow anyone to update polls (needed for closing polls)
CREATE POLICY "Allow public update access on polls" ON polls
  FOR UPDATE USING (true) WITH CHECK (true);