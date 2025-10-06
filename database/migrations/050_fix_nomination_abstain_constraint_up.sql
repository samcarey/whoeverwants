-- Fix vote_structure_valid constraint to properly handle nomination abstain votes
-- The issue: constraint requires nominations IS NULL for abstain, but we need to allow empty arrays too

ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;

-- Add updated constraint that handles nominations with abstain properly
-- For nomination votes: allow either (nominations array with is_abstain=false) OR (null/empty nominations with is_abstain=true)
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
    (vote_type = 'yes_no' AND
     ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
     ranked_choices IS NULL AND
     nominations IS NULL) OR
    (vote_type = 'ranked_choice' AND
     yes_no_choice IS NULL AND
     ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) AND
     nominations IS NULL) OR
    (vote_type = 'nomination' AND
     yes_no_choice IS NULL AND
     ranked_choices IS NULL AND
     ((nominations IS NOT NULL AND array_length(nominations, 1) > 0 AND is_abstain = false) OR
      ((nominations IS NULL OR array_length(nominations, 1) IS NULL) AND is_abstain = true)))
);
