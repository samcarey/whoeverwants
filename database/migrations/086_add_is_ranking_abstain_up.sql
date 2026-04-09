-- Add separate is_ranking_abstain column for suggestion polls.
-- is_abstain = abstained from suggestions (or full abstain for non-suggestion polls).
-- is_ranking_abstain = abstained from ranking specifically (independent of suggestion abstain).

ALTER TABLE votes ADD COLUMN IF NOT EXISTS is_ranking_abstain BOOLEAN DEFAULT false;

-- Update vote_structure_valid constraint to allow is_ranking_abstain
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
       -- Standard ranked_choice: has rankings, no suggestions
       ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) OR
       -- Suggestion phase: has suggestions (rankings optional, may be ranking-abstained)
       (suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
       -- Suggestion phase abstain (abstained from everything)
       (is_abstain = true AND ranked_choices IS NULL AND (suggestions IS NULL OR array_length(suggestions, 1) IS NULL))
     ))
);
