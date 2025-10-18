-- Replace the participation counting function with iterative fixed-point algorithm
-- This finds the stable set of voters whose conditions are mutually satisfied

CREATE OR REPLACE FUNCTION calculate_valid_participation_votes(poll_id_param UUID)
RETURNS TABLE (
  valid_yes_count INTEGER,
  total_yes_count INTEGER,
  conditions_met BOOLEAN
) AS $$
DECLARE
  current_count INTEGER;
  previous_count INTEGER;
  total_yes INTEGER;
  max_iterations INTEGER := 100;
  iteration INTEGER := 0;
BEGIN
  -- Get total "yes" votes
  SELECT COUNT(*)
  INTO total_yes
  FROM votes
  WHERE poll_id = poll_id_param
    AND vote_type = 'participation'
    AND yes_no_choice = 'yes'
    AND is_abstain = false;

  -- Start iteration with total count
  current_count := total_yes;

  -- Iterate until we reach a stable count (fixed point)
  -- A voter attends only if their conditions are met
  -- We need to find the count where: count = number of voters whose conditions are met at that count
  LOOP
    previous_count := current_count;

    -- Count voters whose conditions are met at current_count
    SELECT COUNT(*)
    INTO current_count
    FROM votes
    WHERE poll_id = poll_id_param
      AND vote_type = 'participation'
      AND yes_no_choice = 'yes'
      AND is_abstain = false
      AND (min_participants IS NULL OR current_count >= min_participants)
      AND (max_participants IS NULL OR current_count <= max_participants);

    -- Check for stability
    EXIT WHEN current_count = previous_count;

    -- Prevent infinite loops (can happen with conflicting max constraints)
    iteration := iteration + 1;
    IF iteration >= max_iterations THEN
      -- If oscillating after many iterations, default to no event
      -- This handles edge cases like: A wants min=2/max=3, B wants min=2/max=3,
      -- C wants min=2/max=none, D wants min=2/max=none (oscillates between 2 and 4)
      current_count := 0;
      EXIT;
    END IF;
  END LOOP;

  -- Event happens if we have a non-zero stable count
  RETURN QUERY SELECT
    current_count::INTEGER,
    total_yes::INTEGER,
    (current_count > 0)::BOOLEAN;
END;
$$ LANGUAGE plpgsql STABLE;
