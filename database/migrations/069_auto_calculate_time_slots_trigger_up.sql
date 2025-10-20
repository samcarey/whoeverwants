-- Create trigger to automatically calculate time slots when participation poll closes
-- This populates the participation_time_slot_rounds table with all elimination rounds

CREATE OR REPLACE FUNCTION calculate_and_store_time_slots()
RETURNS TRIGGER AS $$
DECLARE
  slot_record RECORD;
  current_round_num INTEGER := 1;
  prev_participant_count INTEGER := NULL;
  first_slot BOOLEAN := TRUE;
BEGIN
  -- Only run for participation polls that just closed
  IF NEW.poll_type = 'participation' AND NEW.is_closed = true AND (OLD.is_closed = false OR OLD.is_closed IS NULL) THEN

    -- Clear any existing rounds for this poll (in case of re-calculation)
    DELETE FROM participation_time_slot_rounds WHERE poll_id = NEW.id;

    -- Calculate time slots and store rounds
    FOR slot_record IN
      SELECT * FROM calculate_optimal_time_slot_rounds(NEW.id)
    LOOP
      -- Check if we need to increment round number
      -- Round changes when participant count drops
      IF prev_participant_count IS NOT NULL AND
         slot_record.participant_count < prev_participant_count THEN
        current_round_num := current_round_num + 1;
        first_slot := FALSE;  -- No longer first slot
      END IF;

      -- Insert slot into rounds table
      INSERT INTO participation_time_slot_rounds (
        poll_id,
        round_number,
        slot_date,
        slot_start_time,
        slot_end_time,
        duration_hours,
        participant_count,
        participant_vote_ids,
        participant_names,
        is_winner
      ) VALUES (
        NEW.id,
        current_round_num,
        slot_record.slot_date,
        slot_record.slot_start_time,
        slot_record.slot_end_time,
        slot_record.duration_hours,
        slot_record.participant_count,
        slot_record.participant_vote_ids,
        slot_record.participant_names,
        -- First slot overall is the winner (round 1, earliest time)
        (current_round_num = 1 AND first_slot)
      );

      -- Update tracking variables
      prev_participant_count := slot_record.participant_count;
      IF first_slot THEN
        first_slot := FALSE;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on polls table
CREATE TRIGGER calculate_time_slots_on_close
  AFTER UPDATE ON polls
  FOR EACH ROW
  EXECUTE FUNCTION calculate_and_store_time_slots();

-- Add helpful comments
COMMENT ON FUNCTION calculate_and_store_time_slots IS
'Trigger function that automatically calculates and stores time slot elimination rounds
when a participation poll is closed. Clears existing rounds and recalculates from scratch.';

COMMENT ON TRIGGER calculate_time_slots_on_close ON polls IS
'Automatically calculates optimal time slots when participation poll closes.
Populates participation_time_slot_rounds table with all elimination rounds.';
