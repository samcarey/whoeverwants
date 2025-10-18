-- Fix participation algorithm to work in read-only transactions
-- Rewrite without temp tables using CTEs instead

CREATE OR REPLACE FUNCTION calculate_participating_voters(poll_id_param UUID)
RETURNS TABLE (
  vote_id UUID,
  voter_name TEXT,
  min_participants INTEGER,
  max_participants INTEGER,
  priority_score BIGINT
) AS $$
WITH RECURSIVE
  -- Get all yes voters sorted by priority
  prioritized_voters AS (
    SELECT
      v.id as vote_id,
      v.voter_name,
      v.min_participants,
      v.max_participants,
      v.created_at,
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
      AS priority_score,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN v.max_participants IS NULL THEN 1000000::BIGINT ELSE v.max_participants::BIGINT END DESC,
          v.min_participants ASC NULLS FIRST,
          v.created_at ASC
      ) as priority_rank
    FROM votes v
    WHERE v.poll_id = poll_id_param
      AND v.vote_type = 'participation'
      AND v.yes_no_choice = 'yes'
      AND v.is_abstain = false
  ),
  -- Recursive CTE to greedily select compatible voters
  selection AS (
    -- Base case: select highest priority voter who can participate alone
    SELECT
      pv.vote_id,
      pv.voter_name,
      pv.min_participants,
      pv.max_participants,
      pv.priority_score,
      pv.priority_rank,
      1 as current_count,
      ARRAY[pv.vote_id] as included_ids
    FROM prioritized_voters pv
    WHERE pv.priority_rank = 1
      AND (pv.min_participants IS NULL OR 1 >= pv.min_participants)
      AND (pv.max_participants IS NULL OR 1 <= pv.max_participants)

    UNION ALL

    -- Recursive case: try to add next voter in priority order
    SELECT
      pv.vote_id,
      pv.voter_name,
      pv.min_participants,
      pv.max_participants,
      pv.priority_score,
      pv.priority_rank,
      s.current_count + 1,
      s.included_ids || pv.vote_id
    FROM selection s
    CROSS JOIN prioritized_voters pv
    WHERE pv.priority_rank = (
      -- Find next voter not yet included
      SELECT MIN(pv2.priority_rank)
      FROM prioritized_voters pv2
      WHERE pv2.priority_rank > s.priority_rank
        AND NOT (pv2.vote_id = ANY(s.included_ids))
    )
    AND pv.priority_rank > s.priority_rank
    AND NOT (pv.vote_id = ANY(s.included_ids))
    -- Check if this voter's constraints are satisfied
    AND (pv.min_participants IS NULL OR s.current_count + 1 >= pv.min_participants)
    AND (pv.max_participants IS NULL OR s.current_count + 1 <= pv.max_participants)
    -- Check if all existing voters' constraints still satisfied
    AND NOT EXISTS (
      SELECT 1
      FROM prioritized_voters existing
      WHERE existing.vote_id = ANY(s.included_ids)
        AND existing.max_participants IS NOT NULL
        AND s.current_count + 1 > existing.max_participants
    )
  ),
  -- Get final state (maximum count reached)
  final_state AS (
    SELECT *
    FROM selection
    ORDER BY current_count DESC, priority_rank DESC
    LIMIT 1
  )
SELECT
  pv.vote_id,
  pv.voter_name,
  pv.min_participants,
  pv.max_participants,
  pv.priority_score
FROM prioritized_voters pv
INNER JOIN final_state fs ON pv.vote_id = ANY(fs.included_ids)
ORDER BY pv.priority_score DESC;
$$ LANGUAGE sql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_participating_voters(UUID) TO anon, authenticated;
