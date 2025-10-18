-- Implement participation algorithm that prioritizes voters with fewer constraints
-- Philosophy: Maximize inclusion by preferring flexible voters over restrictive ones
-- Returns specific vote IDs that should participate, not just a count

-- Function to determine which voters participate based on priority ranking
CREATE OR REPLACE FUNCTION calculate_participating_voters(poll_id_param UUID)
RETURNS TABLE (
  vote_id UUID,
  voter_name TEXT,
  min_participants INTEGER,
  max_participants INTEGER,
  priority_score BIGINT
) AS $$
DECLARE
  current_voter RECORD;
  current_count INTEGER := 0;
  included_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- Create temp table to track priority-sorted voters
  CREATE TEMP TABLE IF NOT EXISTS prioritized_voters ON COMMIT DROP AS
  SELECT
    v.id as vote_id,
    v.voter_name,
    v.min_participants,
    v.max_participants,
    -- Priority calculation:
    -- 1. No max constraint = highest priority (use large number: 1000000)
    -- 2. Higher max = higher priority
    -- 3. Lower min = higher priority (subtract to invert)
    -- 4. Earlier timestamp = higher priority (use negative microseconds for tiebreak)
    CASE
      WHEN v.max_participants IS NULL THEN 1000000::BIGINT
      ELSE v.max_participants::BIGINT
    END * 1000000
    - COALESCE(v.min_participants, 0) * 1000
    - EXTRACT(EPOCH FROM v.created_at)::BIGINT
    AS priority_score
  FROM votes v
  WHERE v.poll_id = poll_id_param
    AND v.vote_type = 'participation'
    AND v.yes_no_choice = 'yes'
    AND v.is_abstain = false
  ORDER BY
    CASE
      WHEN v.max_participants IS NULL THEN 1000000::BIGINT
      ELSE v.max_participants::BIGINT
    END DESC,
    v.min_participants ASC NULLS FIRST,
    v.created_at ASC;

  -- Greedy selection: iterate through voters in priority order
  FOR current_voter IN SELECT * FROM prioritized_voters LOOP
    DECLARE
      would_be_count INTEGER := current_count + 1;
      voter_satisfied BOOLEAN;
      all_existing_satisfied BOOLEAN;
    BEGIN
      -- Check if this voter's constraints are satisfied by new count
      voter_satisfied := (
        (current_voter.min_participants IS NULL OR would_be_count >= current_voter.min_participants)
        AND (current_voter.max_participants IS NULL OR would_be_count <= current_voter.max_participants)
      );

      -- Check if all previously included voters still have their constraints satisfied
      all_existing_satisfied := NOT EXISTS (
        SELECT 1
        FROM prioritized_voters pv
        WHERE pv.vote_id = ANY(included_ids)
          AND pv.max_participants IS NOT NULL
          AND would_be_count > pv.max_participants
      );

      -- Include this voter if both conditions are met
      IF voter_satisfied AND all_existing_satisfied THEN
        included_ids := array_append(included_ids, current_voter.vote_id);
        current_count := would_be_count;
      END IF;
    END;
  END LOOP;

  -- Return the selected voters
  RETURN QUERY
  SELECT
    pv.vote_id,
    pv.voter_name,
    pv.min_participants,
    pv.max_participants,
    pv.priority_score
  FROM prioritized_voters pv
  WHERE pv.vote_id = ANY(included_ids)
  ORDER BY pv.priority_score DESC;

  DROP TABLE IF EXISTS prioritized_voters;
END;
$$ LANGUAGE plpgsql;

-- Updated function to return summary statistics
CREATE OR REPLACE FUNCTION calculate_valid_participation_votes(poll_id_param UUID)
RETURNS TABLE (
  valid_yes_count INTEGER,
  total_yes_count INTEGER,
  conditions_met BOOLEAN
) AS $$
DECLARE
  participating_count INTEGER;
  total_yes INTEGER;
BEGIN
  -- Count how many voters are participating based on priority algorithm
  SELECT COUNT(*)
  INTO participating_count
  FROM calculate_participating_voters(poll_id_param);

  -- Get total "yes" votes
  SELECT COUNT(*)
  INTO total_yes
  FROM votes
  WHERE poll_id = poll_id_param
    AND vote_type = 'participation'
    AND yes_no_choice = 'yes'
    AND is_abstain = false;

  -- Event happens if we have at least one participant
  RETURN QUERY SELECT
    participating_count::INTEGER,
    total_yes::INTEGER,
    (participating_count > 0)::BOOLEAN;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_participating_voters(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION calculate_valid_participation_votes(UUID) TO anon, authenticated;
