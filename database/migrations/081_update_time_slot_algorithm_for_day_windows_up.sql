-- Stub: Update time slot algorithm to handle per-day time windows
-- Temporarily returns empty while UI is being implemented
-- Full algorithm implementation will come in a follow-up migration

DROP FUNCTION IF EXISTS calculate_optimal_time_slot_rounds(UUID);

CREATE OR REPLACE FUNCTION calculate_optimal_time_slot_rounds(poll_id_param UUID)
RETURNS TABLE (
  round_number INTEGER,
  slot_date DATE,
  slot_start_time TIME,
  slot_end_time TIME,
  duration_hours NUMERIC,
  participant_count INTEGER,
  participant_vote_ids UUID[],
  participant_names TEXT[]
) AS $$
BEGIN
  -- Stub: Return empty for now
  -- Full implementation will check day_time_windows and voter_day_time_windows
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_optimal_time_slot_rounds(UUID) TO anon, authenticated;

-- Update comment
COMMENT ON FUNCTION calculate_optimal_time_slot_rounds IS
'Stub: Will calculate optimal time slots using per-day time windows. Full implementation pending.';
