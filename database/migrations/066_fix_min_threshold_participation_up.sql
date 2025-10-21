-- Fix participation algorithm to handle cases where all voters require minimum thresholds
-- The previous greedy algorithm failed when no voter could participate alone (count=1)
-- This implements a fixed-point algorithm that starts with all voters and iteratively checks stability

CREATE OR REPLACE FUNCTION calculate_participating_voters(poll_id_param UUID)
RETURNS TABLE (
  vote_id UUID,
  voter_name TEXT,
  min_participants INTEGER,
  max_participants INTEGER,
  priority_score BIGINT
) AS $$
WITH RECURSIVE
  -- Get all yes voters
  yes_voters AS (
    SELECT
      v.id as vote_id,
      v.voter_name,
      v.min_participants,
      v.max_participants,
      -- Priority calculation (for tie-breaking when multiple stable configs exist):
      -- 1. No max constraint = highest priority
      -- 2. Higher max = higher priority
      -- 3. Lower min = higher priority
      -- 4. Earlier timestamp = tiebreaker
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
  ),
  -- Fixed-point iteration: try different participant counts starting from the maximum
  -- For each count, select the best voters and check if it's stable
  test_counts AS (
    SELECT generate_series(
      (SELECT COUNT(*)::INTEGER FROM yes_voters),
      0,
      -1
    ) as target_count
  ),
  -- For each possible count, find the best stable configuration
  stable_configs AS (
    SELECT DISTINCT ON (tc.target_count)
      tc.target_count,
      array_agg(yv.vote_id ORDER BY yv.priority_score DESC) as selected_ids
    FROM test_counts tc
    CROSS JOIN LATERAL (
      -- Get top N voters by priority who can participate at this count
      SELECT yv.*
      FROM yes_voters yv
      WHERE (yv.min_participants IS NULL OR tc.target_count >= yv.min_participants)
        AND (yv.max_participants IS NULL OR tc.target_count <= yv.max_participants)
      ORDER BY yv.priority_score DESC
      LIMIT tc.target_count
    ) yv
    WHERE tc.target_count > 0  -- Skip count=0
    GROUP BY tc.target_count
    HAVING COUNT(*) = tc.target_count  -- Ensure we found exactly target_count voters
  ),
  -- Select the configuration with the most participants
  best_config AS (
    SELECT selected_ids
    FROM stable_configs
    ORDER BY target_count DESC
    LIMIT 1
  )
-- Return the selected voters
SELECT
  yv.vote_id,
  yv.voter_name,
  yv.min_participants,
  yv.max_participants,
  yv.priority_score
FROM yes_voters yv
WHERE EXISTS (
  SELECT 1
  FROM best_config bc
  WHERE yv.vote_id = ANY(bc.selected_ids)
)
ORDER BY yv.priority_score DESC;
$$ LANGUAGE sql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_participating_voters(UUID) TO anon, authenticated;
