-- Update vote_yes_no_valid constraint to allow abstain votes for both yes_no and ranked_choice
-- Drop the existing constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_yes_no_valid;

-- Add updated constraint that allows abstain for both vote types
ALTER TABLE votes ADD CONSTRAINT vote_yes_no_valid CHECK (
    (vote_type = 'yes_no' AND (
        (is_abstain = true AND yes_no_choice IS NULL) OR 
        (is_abstain = false AND yes_no_choice IS NOT NULL)
    ) AND ranked_choices IS NULL) OR
    (vote_type = 'ranked_choice' AND yes_no_choice IS NULL AND (
        (is_abstain = true AND ranked_choices IS NULL) OR
        (is_abstain = false AND ranked_choices IS NOT NULL)
    ))
);