-- Rename "nomination" poll type to "suggestion" everywhere
-- This migration updates:
--   1. polls.poll_type values
--   2. votes.vote_type values
--   3. votes.nominations column → votes.suggestions
--   4. All CHECK constraints referencing 'nomination' or 'nominations'

-- 1. Update poll_type values in polls table
UPDATE polls SET poll_type = 'suggestion' WHERE poll_type = 'nomination';

-- 2. Update vote_type values in votes table
UPDATE votes SET vote_type = 'suggestion' WHERE vote_type = 'nomination';

-- 3. Rename the column
ALTER TABLE votes RENAME COLUMN nominations TO suggestions;

-- 4. Recreate poll type constraint
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
    CHECK (poll_type IN ('yes_no', 'ranked_choice', 'suggestion', 'participation'));

-- 5. Recreate vote type constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
    CHECK (vote_type IN ('yes_no', 'ranked_choice', 'suggestion', 'participation'));

-- 6. Recreate vote structure constraint with renamed column
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
     ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) AND
     suggestions IS NULL) OR
    (vote_type = 'suggestion' AND
     yes_no_choice IS NULL AND
     ranked_choices IS NULL AND
     ((suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
      ((suggestions IS NULL OR array_length(suggestions, 1) IS NULL) AND is_abstain = true)))
);
