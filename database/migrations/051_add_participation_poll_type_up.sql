-- Add participation poll type and min/max participant fields

-- Add min_participants and max_participants columns to polls table
ALTER TABLE polls
ADD COLUMN IF NOT EXISTS min_participants INTEGER,
ADD COLUMN IF NOT EXISTS max_participants INTEGER;

-- Update poll_type check constraint to include 'participation'
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
CHECK (poll_type IN ('yes_no', 'ranked_choice', 'nomination', 'participation'));

-- Update vote_type check constraint to include 'participation'
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
CHECK (vote_type IN ('yes_no', 'ranked_choice', 'nomination', 'participation'));

-- Add constraint to ensure max_participants >= min_participants when both are set
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_participants_range_check;
ALTER TABLE polls ADD CONSTRAINT polls_participants_range_check
CHECK (
  (min_participants IS NULL AND max_participants IS NULL) OR
  (min_participants IS NULL AND max_participants IS NOT NULL) OR
  (min_participants IS NOT NULL AND max_participants IS NULL) OR
  (min_participants IS NOT NULL AND max_participants IS NOT NULL AND max_participants >= min_participants)
);

-- Add constraint to ensure min_participants is at least 1 when set
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_min_participants_check;
ALTER TABLE polls ADD CONSTRAINT polls_min_participants_check
CHECK (min_participants IS NULL OR min_participants >= 1);
