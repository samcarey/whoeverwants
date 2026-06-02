-- Migration 130: "Limited Supply" question type.
--
-- A limited-supply question hands out a fixed number of slots first-come,
-- first-served: there are N spots for something (tickets, leftover pizza,
-- a ride, a volunteer shift) and whoever claims first gets them. Voters
-- either CLAIM a spot (is_abstain = false) or DECLINE (is_abstain = true);
-- the first `supply_count` claims (ordered by created_at) are "secured",
-- the rest are "waitlisted". If an earlier claimer later declines, the
-- next waitlisted claimer is promoted automatically (results are computed
-- dynamically from the ordered claim list).
--
-- Storage: a claim/decline reuses the existing yes_no-shaped vote row with
-- no choice payload (yes_no_choice / ranked_choices / suggestions all NULL).
-- The new `questions.supply_count` column holds the number of slots.

BEGIN;

-- 1. The slot count for a limited-supply question. NULL for every other type.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS supply_count INTEGER;

-- 2. Allow 'limited_supply' as a question_type. The constraint was created on
--    the old `polls` table (migration 094 → `polls_poll_type_check`) and
--    renamed-by-table to live on `questions`; DROP every plausible alias.
ALTER TABLE questions
    DROP CONSTRAINT IF EXISTS polls_poll_type_check,
    DROP CONSTRAINT IF EXISTS poll_type_check,
    DROP CONSTRAINT IF EXISTS questions_question_type_check,
    ADD CONSTRAINT questions_question_type_check
        CHECK (question_type IN ('yes_no', 'ranked_choice', 'time', 'limited_supply'));

-- 3. Allow 'limited_supply' as a vote_type.
ALTER TABLE votes
    DROP CONSTRAINT IF EXISTS votes_vote_type_check,
    DROP CONSTRAINT IF EXISTS vote_type_check,
    ADD CONSTRAINT votes_vote_type_check
        CHECK (vote_type IN ('yes_no', 'ranked_choice', 'time', 'limited_supply'));

-- 4. Recreate vote_structure_valid with the limited_supply branch. A
--    limited-supply vote carries no choice payload — claim vs decline is
--    is_abstain alone.
ALTER TABLE votes
    DROP CONSTRAINT IF EXISTS vote_structure_valid,
    ADD CONSTRAINT vote_structure_valid CHECK (
        (vote_type = 'yes_no' AND
         ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
         ranked_choices IS NULL AND
         suggestions IS NULL) OR
        (vote_type = 'ranked_choice' AND
         yes_no_choice IS NULL AND
         (
           ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) OR
           (suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
           (is_abstain = true AND ranked_choices IS NULL AND (suggestions IS NULL OR array_length(suggestions, 1) IS NULL))
         )) OR
        (vote_type = 'time' AND
         yes_no_choice IS NULL) OR
        (vote_type = 'limited_supply' AND
         yes_no_choice IS NULL AND
         ranked_choices IS NULL AND
         suggestions IS NULL)
    );

COMMIT;
