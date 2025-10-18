-- Fix participation vote counting to handle oscillation correctly
-- When oscillation is detected (no fixed point exists), prefer the lower count
-- This handles cases like: Voter A wants exactly N, Voter B wants N+, causing oscillation between N and N+1

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
  seen_counts INTEGER[] := ARRAY[]::INTEGER[];
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
  LOOP
    previous_count := current_count;

    -- Track this count for oscillation detection
    seen_counts := array_append(seen_counts, current_count);

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

    -- Check for stability (fixed point found)
    EXIT WHEN current_count = previous_count;

    -- Check for oscillation by looking for repeated counts
    IF current_count = ANY(seen_counts[1:array_length(seen_counts, 1)-1]) THEN
      -- Oscillation detected - find the minimum non-zero count in the cycle
      -- This represents the stable configuration with the smallest viable group
      SELECT MIN(count_val)
      INTO current_count
      FROM unnest(seen_counts) AS count_val
      WHERE count_val > 0;

      -- If all counts were 0, keep it at 0
      IF current_count IS NULL THEN
        current_count := 0;
      END IF;

      EXIT;
    END IF;

    -- Safety limit to prevent infinite loops
    iteration := iteration + 1;
    IF iteration >= max_iterations THEN
      -- This should never happen with oscillation detection above,
      -- but kept as a safety net
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
