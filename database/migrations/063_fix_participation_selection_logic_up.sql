-- Fix participation voter selection to properly implement greedy algorithm
-- The previous version had issues with the recursive CTE returning multiple states

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
      -- Priority calculation:
      -- 1. No max constraint = highest priority (use large number: 1000000)
      -- 2. Higher max = higher priority
      -- 3. Lower min = higher priority (subtract to invert)
      -- 4. Earlier timestamp = higher priority (use negative epoch for tiebreak)
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
          COALESCE(v.min_participants, 0) ASC,
          v.created_at ASC
      ) as priority_rank
    FROM votes v
    WHERE v.poll_id = poll_id_param
      AND v.vote_type = 'participation'
      AND v.yes_no_choice = 'yes'
      AND v.is_abstain = false
  ),
  -- Recursive greedy selection: build up the participant set one voter at a time
  greedy_selection AS (
    -- Base case: start with highest priority voter if they can participate alone
    SELECT
      1 as iteration,
      ARRAY[pv.vote_id] as selected_ids,
      1 as participant_count
    FROM prioritized_voters pv
    WHERE pv.priority_rank = 1
      AND (pv.min_participants IS NULL OR 1 >= pv.min_participants)
      AND (pv.max_participants IS NULL OR 1 <= pv.max_participants)

    UNION ALL

    -- Recursive case: try to add the next highest priority voter
    SELECT
      gs.iteration + 1,
      gs.selected_ids || next_voter.vote_id,
      gs.participant_count + 1
    FROM greedy_selection gs
    CROSS JOIN LATERAL (
      -- Find next voter in priority order who isn't already selected
      SELECT pv.*
      FROM prioritized_voters pv
      WHERE NOT (pv.vote_id = ANY(gs.selected_ids))
        -- This voter's constraints must be satisfied at new count
        AND (pv.min_participants IS NULL OR gs.participant_count + 1 >= pv.min_participants)
        AND (pv.max_participants IS NULL OR gs.participant_count + 1 <= pv.max_participants)
        -- All already-selected voters' constraints must still be satisfied
        AND NOT EXISTS (
          SELECT 1
          FROM prioritized_voters existing
          WHERE existing.vote_id = ANY(gs.selected_ids)
            AND existing.max_participants IS NOT NULL
            AND gs.participant_count + 1 > existing.max_participants
        )
      ORDER BY pv.priority_rank ASC
      LIMIT 1
    ) AS next_voter
    WHERE gs.iteration < 100  -- Safety limit
  ),
  -- Get the final selection (the one with the most participants)
  final_selection AS (
    SELECT selected_ids
    FROM greedy_selection
    ORDER BY participant_count DESC
    LIMIT 1
  )
-- Return details of selected voters
SELECT
  pv.vote_id,
  pv.voter_name,
  pv.min_participants,
  pv.max_participants,
  pv.priority_score
FROM prioritized_voters pv
WHERE EXISTS (
  SELECT 1
  FROM final_selection fs
  WHERE pv.vote_id = ANY(fs.selected_ids)
)
ORDER BY pv.priority_score DESC;
$$ LANGUAGE sql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_participating_voters(UUID) TO anon, authenticated;
