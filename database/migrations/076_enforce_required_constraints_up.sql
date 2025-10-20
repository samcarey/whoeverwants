-- Update validation to enforce that voters must enable same min/max constraints as poll
-- If poll has duration.minEnabled=true, voter must also have it enabled
-- If poll has time.maxEnabled=true, voter must also have it enabled

CREATE OR REPLACE FUNCTION validate_voter_conditions_subset()
RETURNS TRIGGER AS $$
DECLARE
  poll_record RECORD;
BEGIN
  -- Only validate for participation polls with yes votes
  IF NEW.vote_type != 'participation' OR NEW.is_abstain OR NEW.yes_no_choice != 'yes' THEN
    RETURN NEW;
  END IF;

  -- Get poll constraints
  SELECT
    possible_days,
    duration_window,
    time_window
  INTO poll_record
  FROM polls
  WHERE id = NEW.poll_id;

  -- Validate voter_days is subset of poll.possible_days
  IF NEW.voter_days IS NOT NULL AND poll_record.possible_days IS NOT NULL THEN
    IF NOT (NEW.voter_days <@ poll_record.possible_days) THEN
      RAISE EXCEPTION 'Voter dates must be a subset of poll possible dates. Poll days: %, Voter days: %',
        array_to_string(poll_record.possible_days, ', '),
        array_to_string(NEW.voter_days, ', ');
    END IF;
  END IF;

  -- Validate voter_duration is within poll.duration_window
  IF NEW.voter_duration IS NOT NULL AND poll_record.duration_window IS NOT NULL THEN
    -- Check that voter has enabled same constraints as poll
    IF (poll_record.duration_window->>'minEnabled')::boolean AND NOT (NEW.voter_duration->>'minEnabled')::boolean THEN
      RAISE EXCEPTION 'Minimum duration must be specified (poll requires it)';
    END IF;

    IF (poll_record.duration_window->>'maxEnabled')::boolean AND NOT (NEW.voter_duration->>'maxEnabled')::boolean THEN
      RAISE EXCEPTION 'Maximum duration must be specified (poll requires it)';
    END IF;

    -- Check min duration
    IF (NEW.voter_duration->>'minEnabled')::boolean AND (poll_record.duration_window->>'minEnabled')::boolean THEN
      IF (NEW.voter_duration->>'minValue')::numeric < (poll_record.duration_window->>'minValue')::numeric THEN
        RAISE EXCEPTION 'Voter minimum duration (% hours) must be at least poll minimum duration (% hours)',
          (NEW.voter_duration->>'minValue')::numeric,
          (poll_record.duration_window->>'minValue')::numeric;
      END IF;
    END IF;

    -- Check max duration
    IF (NEW.voter_duration->>'maxEnabled')::boolean AND (poll_record.duration_window->>'maxEnabled')::boolean THEN
      IF (NEW.voter_duration->>'maxValue')::numeric > (poll_record.duration_window->>'maxValue')::numeric THEN
        RAISE EXCEPTION 'Voter maximum duration (% hours) cannot exceed poll maximum duration (% hours)',
          (NEW.voter_duration->>'maxValue')::numeric,
          (poll_record.duration_window->>'maxValue')::numeric;
      END IF;
    END IF;
  END IF;

  -- Validate voter_time is within poll.time_window
  -- Assumes time windows don't cross midnight (max > min, within 24 hours)
  IF NEW.voter_time IS NOT NULL AND poll_record.time_window IS NOT NULL THEN
    -- Check that voter has enabled same constraints as poll
    IF (poll_record.time_window->>'minEnabled')::boolean AND NOT (NEW.voter_time->>'minEnabled')::boolean THEN
      RAISE EXCEPTION 'Start time must be specified (poll requires it)';
    END IF;

    IF (poll_record.time_window->>'maxEnabled')::boolean AND NOT (NEW.voter_time->>'maxEnabled')::boolean THEN
      RAISE EXCEPTION 'End time must be specified (poll requires it)';
    END IF;

    -- Check min time
    IF (NEW.voter_time->>'minEnabled')::boolean AND (poll_record.time_window->>'minEnabled')::boolean THEN
      IF (NEW.voter_time->>'minValue')::time < (poll_record.time_window->>'minValue')::time THEN
        RAISE EXCEPTION 'Voter start time (%) must be at or after poll start time (%)',
          (NEW.voter_time->>'minValue')::text,
          (poll_record.time_window->>'minValue')::text;
      END IF;
    END IF;

    -- Check max time
    IF (NEW.voter_time->>'maxEnabled')::boolean AND (poll_record.time_window->>'maxEnabled')::boolean THEN
      IF (NEW.voter_time->>'maxValue')::time > (poll_record.time_window->>'maxValue')::time THEN
        RAISE EXCEPTION 'Voter end time (%) cannot be later than poll end time (%)',
          (NEW.voter_time->>'maxValue')::text,
          (poll_record.time_window->>'maxValue')::text;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update comment to reflect new behavior
COMMENT ON FUNCTION validate_voter_conditions_subset IS
'Validates that voter conditions (days, duration, time) are subsets/within poll conditions.
Ensures voters must enable same min/max constraints that poll creator enabled.
Ensures data integrity by preventing voters from specifying availability outside poll constraints.
Assumes time windows do not cross midnight (max > min, within 24 hours).';
