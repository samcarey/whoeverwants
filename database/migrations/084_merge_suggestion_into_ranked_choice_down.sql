-- Rollback: restore suggestion as a separate poll type

-- 1. Restore vote_structure_valid constraint (suggestion-exclusive)
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

-- 2. Restore vote_type constraint (with 'suggestion')
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
    CHECK (vote_type IN ('yes_no', 'ranked_choice', 'suggestion', 'participation'));

-- 3. Restore poll_type constraint (with 'suggestion')
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
    CHECK (poll_type IN ('yes_no', 'ranked_choice', 'suggestion', 'participation'));

-- 4. Restore suggestion votes
UPDATE votes SET vote_type = 'suggestion'
WHERE vote_type = 'ranked_choice'
  AND suggestions IS NOT NULL
  AND ranked_choices IS NULL;

-- 5. Restore suggestion polls
UPDATE polls SET poll_type = 'suggestion'
WHERE poll_type = 'ranked_choice'
  AND suggestion_deadline IS NOT NULL;

-- 6. Remove new columns
ALTER TABLE polls DROP COLUMN IF EXISTS suggestion_deadline;
ALTER TABLE polls DROP COLUMN IF EXISTS allow_pre_ranking;
