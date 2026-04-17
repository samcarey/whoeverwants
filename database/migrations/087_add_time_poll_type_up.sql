-- Add 'time' poll type for scheduling polls.
-- Time polls have two phases:
--   1. Availability: voters enter their day/time windows (uses suggestion_deadline columns)
--   2. Preferences: voters rank generated time slots (uses ranked_choices)
-- Resolution uses IRV on preference ballots filtered by availability threshold.

-- Add availability_threshold: % below max availability still included (default 5%).
-- Renamed/re-semanticised to min_availability_percent in migration 090.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS availability_threshold INTEGER DEFAULT 5;

-- Update poll_type constraint to include 'time'
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
  CHECK (poll_type IN ('yes_no', 'ranked_choice', 'participation', 'time'));

-- Update vote_type constraint to include 'time'
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
  CHECK (vote_type IN ('yes_no', 'ranked_choice', 'participation', 'time'));

-- Update vote_structure_valid to include 'time' vote structure.
-- Time poll votes can have:
--   - voter_day_time_windows (availability phase)
--   - ranked_choices (preferences phase, may coexist with day_time_windows)
--   - is_abstain = true (abstain)
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
       ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) OR
       (suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
       (is_abstain = true AND ranked_choices IS NULL AND (suggestions IS NULL OR array_length(suggestions, 1) IS NULL))
     )) OR
    (vote_type = 'time' AND
     yes_no_choice IS NULL AND
     suggestions IS NULL AND
     (
       (voter_day_time_windows IS NOT NULL AND is_abstain = false) OR
       (ranked_choices IS NOT NULL AND is_abstain = false) OR
       (is_abstain = true)
     ))
);
