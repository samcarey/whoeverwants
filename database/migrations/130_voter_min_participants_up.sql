-- Per-voter "minimum participants" (conditional attendance) for time polls.
--
-- A time respondent can now attach a personal turnout threshold to their
-- availability: "only count me as available for a slot if at least N people
-- total are available for it." The winner/viability algorithm applies this as a
-- fixed point per slot — dropping a voter from a slot can push the count below
-- another voter's threshold, cascading until stable (see
-- algorithms/time_question.py: _effective_attendance).
--
-- NULL = no personal constraint (the voter attends whenever they're available),
-- which is the backward-compatible default (equivalent to a threshold of 1).
-- This is the per-voter mirror of the creator's `questions.time_min_participants`
-- viability gate (migration 129) and composes with it.

ALTER TABLE votes ADD COLUMN IF NOT EXISTS voter_min_participants INTEGER;
