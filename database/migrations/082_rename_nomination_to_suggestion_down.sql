-- Revert "suggestion" back to "nomination"

-- 1. Revert poll_type values
UPDATE polls SET poll_type = 'nomination' WHERE poll_type = 'suggestion';

-- 2. Revert vote_type values
UPDATE votes SET vote_type = 'nomination' WHERE vote_type = 'suggestion';

-- 3. Rename column back
ALTER TABLE votes RENAME COLUMN suggestions TO nominations;

-- 4. Recreate poll type constraint
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
    CHECK (poll_type IN ('yes_no', 'ranked_choice', 'nomination', 'participation'));

-- 5. Recreate vote type constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
    CHECK (vote_type IN ('yes_no', 'ranked_choice', 'nomination', 'participation'));

-- 6. Recreate vote structure constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
    (vote_type = 'yes_no' AND
     ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
     ranked_choices IS NULL AND
     nominations IS NULL) OR
    (vote_type = 'participation' AND
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
