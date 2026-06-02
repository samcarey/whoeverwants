-- Down migration for 130: remove the limited_supply question type.
--
-- Best-effort: deletes limited-supply questions (and their votes via the FK
-- CASCADE) so the narrowed CHECK constraints can be re-applied, then drops
-- the supply_count column. Cannot recover deleted data.

BEGIN;

DELETE FROM questions WHERE question_type = 'limited_supply';

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
         yes_no_choice IS NULL)
    );

ALTER TABLE votes
    DROP CONSTRAINT IF EXISTS votes_vote_type_check,
    ADD CONSTRAINT votes_vote_type_check
        CHECK (vote_type IN ('yes_no', 'ranked_choice', 'time'));

ALTER TABLE questions
    DROP CONSTRAINT IF EXISTS questions_question_type_check,
    ADD CONSTRAINT questions_question_type_check
        CHECK (question_type IN ('yes_no', 'ranked_choice', 'time'));

ALTER TABLE questions DROP COLUMN IF EXISTS supply_count;

COMMIT;
