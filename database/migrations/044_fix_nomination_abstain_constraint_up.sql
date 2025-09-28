-- Fix nomination abstain constraint to allow null nominations when abstaining
-- Migration: 044_fix_nomination_abstain_constraint
-- Description: Updates vote structure constraint to allow null nominations for abstain votes

-- Drop the existing constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;

-- Add updated constraint that allows null nominations when abstaining
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
    (vote_type = 'yes_no' AND ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND ranked_choices IS NULL AND nominations IS NULL) OR
    (vote_type = 'ranked_choice' AND yes_no_choice IS NULL AND ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) AND nominations IS NULL) OR
    (vote_type = 'nomination' AND yes_no_choice IS NULL AND ranked_choices IS NULL AND ((nominations IS NOT NULL AND is_abstain = false) OR (nominations IS NULL AND is_abstain = true)))
);