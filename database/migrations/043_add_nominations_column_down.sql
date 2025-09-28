-- Remove nominations column from votes table
-- Migration: 043_add_nominations_column (down)
-- Description: Removes nomination support from votes table

-- Drop nominations column
ALTER TABLE votes DROP COLUMN IF EXISTS nominations;

-- Restore original vote type constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT vote_type_check CHECK (vote_type IN ('yes_no', 'ranked_choice'));

-- Restore original vote structure constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;
ALTER TABLE votes ADD CONSTRAINT vote_yes_no_valid CHECK (
    (vote_type = 'yes_no' AND yes_no_choice IS NOT NULL AND ranked_choices IS NULL) OR
    (vote_type = 'ranked_choice' AND yes_no_choice IS NULL AND ranked_choices IS NOT NULL)
);