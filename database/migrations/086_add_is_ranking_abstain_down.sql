-- Remove is_ranking_abstain column and restore original constraint

ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
    (vote_type = 'yes_no' AND
     ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
     ranked_choices IS NULL AND
     suggestions IS NULL) OR
    (vote_type = 'participation' AND
     ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
     ranked_choices IS NULL AND
     suggestions IS NULL) OR
    (vote_type = 'ranked_choice' AND
     yes_no_choice IS NULL AND
     (
       ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) OR
       (suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
       (is_abstain = true AND ranked_choices IS NULL AND (suggestions IS NULL OR array_length(suggestions, 1) IS NULL))
     ))
);

ALTER TABLE votes DROP COLUMN IF EXISTS is_ranking_abstain;
