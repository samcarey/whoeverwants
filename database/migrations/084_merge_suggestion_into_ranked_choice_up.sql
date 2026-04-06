-- Merge suggestion polls into ranked_choice polls.
-- Suggestion is now an optional first phase of a ranked_choice poll,
-- controlled by a suggestion_deadline column.

-- 1. Add suggestion_deadline and allow_pre_ranking to polls
ALTER TABLE polls ADD COLUMN IF NOT EXISTS suggestion_deadline TIMESTAMPTZ;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS allow_pre_ranking BOOLEAN DEFAULT true;

-- 2. Migrate existing suggestion polls to ranked_choice with suggestion_deadline
-- For open suggestion polls: move response_deadline → suggestion_deadline,
-- set a new response_deadline based on auto_preferences_deadline_minutes (or default 2hr)
UPDATE polls
SET poll_type = 'ranked_choice',
    suggestion_deadline = response_deadline,
    response_deadline = CASE
      WHEN auto_preferences_deadline_minutes IS NOT NULL
        THEN response_deadline + (auto_preferences_deadline_minutes || ' minutes')::interval
      ELSE response_deadline + interval '2 hours'
    END
WHERE poll_type = 'suggestion'
  AND is_closed = false;

-- For closed suggestion polls: set suggestion_deadline to when they closed (response_deadline)
-- and keep response_deadline as-is (poll is already done)
UPDATE polls
SET poll_type = 'ranked_choice',
    suggestion_deadline = response_deadline
WHERE poll_type = 'suggestion'
  AND is_closed = true;

-- 3. Delete reserved placeholder preference polls (they're no longer needed)
-- These are closed ranked_choice polls with NULL options that were created as follow-ups
-- to suggestion polls via auto_create_preferences
DELETE FROM polls
WHERE poll_type = 'ranked_choice'
  AND is_closed = true
  AND options IS NULL
  AND follow_up_to IS NOT NULL
  AND follow_up_to IN (
    SELECT id FROM polls WHERE suggestion_deadline IS NOT NULL
  );

-- 4. Migrate existing suggestion votes to ranked_choice
UPDATE votes SET vote_type = 'ranked_choice' WHERE vote_type = 'suggestion';

-- 5. Update poll_type constraint (remove 'suggestion')
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
    CHECK (poll_type IN ('yes_no', 'ranked_choice', 'participation'));

-- 6. Update vote_type constraint (remove 'suggestion')
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
    CHECK (vote_type IN ('yes_no', 'ranked_choice', 'participation'));

-- 7. Update vote_structure_valid: allow ranked_choice votes to have suggestions
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
       -- Suggestion phase: has suggestions (rankings optional)
       (suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
       -- Suggestion phase abstain
       (is_abstain = true AND ranked_choices IS NULL AND (suggestions IS NULL OR array_length(suggestions, 1) IS NULL))
     ))
);
