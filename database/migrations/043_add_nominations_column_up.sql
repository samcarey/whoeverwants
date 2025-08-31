-- Add nominations column to votes table for nomination polls
-- Migration: 043_add_nominations_column
-- Description: Adds nominations column to support nomination poll voting

-- Add nominations column
ALTER TABLE votes ADD COLUMN nominations TEXT[];

-- Update vote type constraint to include nomination
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT vote_type_check CHECK (vote_type IN ('yes_no', 'ranked_choice', 'nomination'));

-- Update vote structure constraint to handle nomination votes
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_yes_no_valid;
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
    (vote_type = 'yes_no' AND yes_no_choice IS NOT NULL AND ranked_choices IS NULL AND nominations IS NULL) OR
    (vote_type = 'ranked_choice' AND yes_no_choice IS NULL AND ranked_choices IS NOT NULL AND nominations IS NULL) OR
    (vote_type = 'nomination' AND yes_no_choice IS NULL AND ranked_choices IS NULL AND nominations IS NOT NULL)
);