-- Add min_participants and max_participants columns to votes table for participation polls
-- These allow each voter to specify their own conditions for participation

ALTER TABLE votes
ADD COLUMN IF NOT EXISTS min_participants INTEGER,
ADD COLUMN IF NOT EXISTS max_participants INTEGER;

-- Add constraint: min must be at least 1 if specified
ALTER TABLE votes
ADD CONSTRAINT votes_min_participants_check CHECK (min_participants IS NULL OR min_participants >= 1);

-- Add constraint: max must be greater than or equal to min if both specified
ALTER TABLE votes
ADD CONSTRAINT votes_max_min_participants_check CHECK (
  max_participants IS NULL OR
  min_participants IS NULL OR
  max_participants >= min_participants
);
