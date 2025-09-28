-- Fix outdated vote_yes_no_valid constraint that's blocking nomination votes
-- This constraint should have been replaced by vote_structure_valid in migration 043

-- Drop the old constraint that doesn't handle nominations
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_yes_no_valid;

-- Ensure the correct constraint exists (may already exist from migration 043/044)
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;

-- Add the proper constraint that handles all vote types including nominations with abstain
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
    (vote_type = 'yes_no' AND ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND ranked_choices IS NULL AND nominations IS NULL) OR
    (vote_type = 'ranked_choice' AND yes_no_choice IS NULL AND ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) AND nominations IS NULL) OR
    (vote_type = 'nomination' AND yes_no_choice IS NULL AND ranked_choices IS NULL AND ((nominations IS NOT NULL AND is_abstain = false) OR (nominations IS NULL AND is_abstain = true)))
);