-- Unify yes_no poll type into ranked_choice
-- yes_no is a special case of ranked_choice with exactly 2 options: ["Yes", "No"]
-- The frontend detects 2-option ranked_choice polls and renders them with the simplified UI

-- Step 1: Convert existing yes_no polls to ranked_choice with options ["Yes", "No"]
UPDATE polls
SET poll_type = 'ranked_choice',
    options = '["Yes", "No"]'::jsonb
WHERE poll_type = 'yes_no';

-- Step 2: Convert yes_no votes on yes_no polls to ranked_choice format
-- (but NOT yes_no votes on participation polls - those get converted to participation type)
-- "yes" -> ranked_choices = ["Yes", "No"] (prefer Yes)
-- "no"  -> ranked_choices = ["No", "Yes"] (prefer No)
UPDATE votes v
SET vote_type = 'ranked_choice',
    ranked_choices = CASE
        WHEN v.yes_no_choice = 'yes' THEN ARRAY['Yes', 'No']
        WHEN v.yes_no_choice = 'no' THEN ARRAY['No', 'Yes']
        ELSE NULL  -- abstain votes keep NULL
    END,
    yes_no_choice = NULL
FROM polls p
WHERE v.vote_type = 'yes_no'
  AND v.poll_id = p.id
  AND p.poll_type = 'ranked_choice';  -- polls already converted in step 1

-- Step 2b: Convert any remaining yes_no votes on participation polls
-- Keep yes_no_choice but change vote_type to participation
UPDATE votes
SET vote_type = 'participation'
WHERE vote_type = 'yes_no';

-- Step 3: Update poll_type constraint to remove yes_no
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
CHECK (poll_type IN ('ranked_choice', 'nomination', 'participation'));

-- Step 4: Update vote_type constraint to remove yes_no
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
CHECK (vote_type IN ('ranked_choice', 'nomination', 'participation'));

-- Step 5: Update vote_structure_valid constraint
-- Remove yes_no branch, participation now uses yes_no_choice directly
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
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
