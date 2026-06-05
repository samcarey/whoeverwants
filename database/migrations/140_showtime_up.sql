-- Migration 140: "Showtime" question type.
--
-- A showtime question behaves like a `time` question but the options are
-- concrete movie showtimes (curated by the creator from real Alamo Drafthouse
-- data) instead of generated 15-minute slots. Voters mark each curated showtime
-- want / neutral / can't-attend — a time-preference ballot where red = "can't
-- attend". Winner = maximize attendance (not-red) → maximize likes → earliest.
--
-- Storage REUSES the time vote shape entirely: per-voter reactions go in the
-- existing `votes.liked_slots` ("want") / `votes.disliked_slots` ("can't
-- attend"). NO new columns — options arrive pre-finalized at create time, so
-- there is no availability phase, slot generation, or min-participants math.

BEGIN;

-- 1. Allow 'showtime' as a question_type (DROP every plausible alias first,
--    mirroring migration 131).
ALTER TABLE questions
    DROP CONSTRAINT IF EXISTS polls_poll_type_check,
    DROP CONSTRAINT IF EXISTS poll_type_check,
    DROP CONSTRAINT IF EXISTS questions_question_type_check,
    ADD CONSTRAINT questions_question_type_check
        CHECK (question_type IN ('yes_no', 'ranked_choice', 'time', 'limited_supply', 'showtime'));

-- 2. Allow 'showtime' as a vote_type.
ALTER TABLE votes
    DROP CONSTRAINT IF EXISTS votes_vote_type_check,
    DROP CONSTRAINT IF EXISTS vote_type_check,
    ADD CONSTRAINT votes_vote_type_check
        CHECK (vote_type IN ('yes_no', 'ranked_choice', 'time', 'limited_supply', 'showtime'));

-- 3. Recreate vote_structure_valid with the showtime branch. A showtime vote
--    carries the same payload shape as a `time` vote: no yes_no_choice; the
--    liked/disliked slot sets are JSONB columns outside this CHECK, so the
--    branch is just `yes_no_choice IS NULL` (mirroring `time`).
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
         suggestions IS NULL) OR
        (vote_type = 'showtime' AND
         yes_no_choice IS NULL)
    );

COMMIT;
