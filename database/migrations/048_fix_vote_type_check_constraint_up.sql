-- Fix votes_vote_type_check constraint to include nomination vote type
-- This constraint is blocking nomination votes with error:
-- "new row for relation "votes" violates check constraint "votes_vote_type_check""

-- First, drop the old constraint that doesn't include 'nomination'
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;

-- Add the updated constraint that includes all three vote types
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
  CHECK (vote_type IN ('yes_no', 'ranked_choice', 'nomination'));

-- Verify the constraint allows nomination votes
-- The vote_structure_valid constraint already handles the proper structure validation