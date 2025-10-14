-- Auto-close participation polls when max capacity is reached
-- Trigger fires after vote insert/update to check if poll should close

CREATE OR REPLACE FUNCTION auto_close_participation_poll()
RETURNS TRIGGER AS $$
DECLARE
  poll_max_participants INT;
  poll_type TEXT;
  poll_is_closed BOOLEAN;
  current_yes_votes INT;
BEGIN
  -- Get poll details
  SELECT p.max_participants, p.poll_type, p.is_closed
  INTO poll_max_participants, poll_type, poll_is_closed
  FROM polls p
  WHERE p.id = NEW.poll_id;

  -- Only process if it's a participation poll that's not already closed
  IF poll_type = 'participation' AND NOT poll_is_closed AND poll_max_participants IS NOT NULL THEN

    -- Count current "yes" votes
    SELECT COUNT(*)
    INTO current_yes_votes
    FROM votes
    WHERE poll_id = NEW.poll_id
      AND vote_type = 'participation'
      AND yes_no_choice = 'yes';

    -- If we've reached max capacity, close the poll
    IF current_yes_votes >= poll_max_participants THEN
      UPDATE polls
      SET is_closed = true,
          close_reason = 'max_capacity'
      WHERE id = NEW.poll_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that fires after vote insert or update
DROP TRIGGER IF EXISTS check_participation_capacity ON votes;
CREATE TRIGGER check_participation_capacity
  AFTER INSERT OR UPDATE ON votes
  FOR EACH ROW
  EXECUTE FUNCTION auto_close_participation_poll();
