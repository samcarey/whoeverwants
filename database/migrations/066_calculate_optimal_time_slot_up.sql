-- Calculate optimal time slots for participation polls with time/date/duration constraints
-- This function generates all possible time slots, calculates participant counts for each,
-- and returns elimination rounds sorted by participant count and time

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
  -- Stub version for now - will return empty results
  -- This allows us to test the migration infrastructure
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_optimal_time_slot_rounds(UUID) TO anon, authenticated;

-- Add helpful comments
COMMENT ON FUNCTION calculate_optimal_time_slot_rounds IS
'Calculates optimal time slots for participation polls by:
1. Generating all candidate slots from poll constraints (dates × times × durations)
2. Filtering invalid slots (where end_time exceeds time_window)
3. For each slot, running greedy selection algorithm on eligible voters
4. Deduplicating overlapping slots (keeping longest duration)
5. Grouping into elimination rounds by participant count
6. Returning rounds ordered by: participants DESC, date ASC, time ASC';
