-- Create table to store participation poll time slot elimination rounds
-- This table stores all candidate time slots grouped by participant count (rounds)
-- The winner is the first slot in round 1 (most participants, earliest time)

CREATE TABLE IF NOT EXISTS participation_time_slot_rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  slot_date DATE NOT NULL,
  slot_start_time TIME NOT NULL,
  slot_end_time TIME NOT NULL,
  duration_hours NUMERIC NOT NULL,
  participant_count INTEGER NOT NULL,
  participant_vote_ids UUID[] NOT NULL,
  participant_names TEXT[] NOT NULL,
  is_winner BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure unique slots per poll and round
  UNIQUE(poll_id, round_number, slot_date, slot_start_time)
);

-- Index for fast lookup by poll
CREATE INDEX idx_time_slot_rounds_poll
  ON participation_time_slot_rounds(poll_id);

-- Index for fast winner lookup
CREATE INDEX idx_time_slot_rounds_winner
  ON participation_time_slot_rounds(poll_id, is_winner)
  WHERE is_winner = true;

-- Index for sorting rounds
CREATE INDEX idx_time_slot_rounds_sorting
  ON participation_time_slot_rounds(poll_id, round_number, participant_count DESC, slot_date, slot_start_time);

-- Enable RLS
ALTER TABLE participation_time_slot_rounds ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anyone can view time slot rounds for any poll
CREATE POLICY "Time slot rounds are publicly viewable"
  ON participation_time_slot_rounds
  FOR SELECT
  USING (true);

-- RLS Policy: Only system can insert/update/delete (via triggers)
CREATE POLICY "Only system can modify time slot rounds"
  ON participation_time_slot_rounds
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Add helpful comments
COMMENT ON TABLE participation_time_slot_rounds IS
'Stores elimination rounds of time slots for participation polls.
Each round groups slots by participant count (descending).
The winner is marked with is_winner=true (first slot in round 1).';

COMMENT ON COLUMN participation_time_slot_rounds.round_number IS
'Elimination round number. Round 1 has most participants, round 2 has second-most, etc.';

COMMENT ON COLUMN participation_time_slot_rounds.is_winner IS
'True for the winning time slot (first slot in round 1: most participants, earliest time).';

COMMENT ON COLUMN participation_time_slot_rounds.participant_vote_ids IS
'Array of vote IDs for voters who can participate in this specific time slot.';

COMMENT ON COLUMN participation_time_slot_rounds.participant_names IS
'Array of voter names corresponding to participant_vote_ids.';
