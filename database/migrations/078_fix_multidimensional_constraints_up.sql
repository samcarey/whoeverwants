-- Fix participation algorithm to check ALL dimensions (days, time, duration, participants)
-- Previous version only checked participant count - this is a critical bug fix

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
      v.voter_days,
      v.voter_time,
      v.voter_duration,
      -- Priority calculation (maximize inclusion preference)
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
  -- Recursive greedy selection with MULTIDIMENSIONAL constraints
  greedy_selection AS (
    -- Base case: start with highest priority voter (don't check min yet)
    SELECT
      1 as iteration,
      ARRAY[pv.vote_id] as selected_ids,
      1 as participant_count,
      pv.voter_days as common_days,
      pv.voter_time as common_time,
      pv.voter_duration as common_duration
    FROM prioritized_voters pv
    WHERE pv.priority_rank = 1

    UNION ALL

    -- Recursive case: try to add next compatible voter
    SELECT
      gs.iteration + 1,
      gs.selected_ids || next_voter.vote_id,
      gs.participant_count + 1,
      next_voter.new_common_days,
      next_voter.new_common_time,
      next_voter.new_common_duration
    FROM greedy_selection gs
    CROSS JOIN LATERAL (
      SELECT
        pv.vote_id,
        -- Calculate intersection of days
        (
          SELECT array_agg(d)
          FROM unnest(gs.common_days) d
          WHERE d = ANY(pv.voter_days)
        ) as new_common_days,
        -- Calculate intersection of time windows
        jsonb_build_object(
          'minValue', GREATEST(
            (gs.common_time->>'minValue')::time,
            (pv.voter_time->>'minValue')::time
          )::text,
          'maxValue', LEAST(
            (gs.common_time->>'maxValue')::time,
            (pv.voter_time->>'maxValue')::time
          )::text,
          'minEnabled', true,
          'maxEnabled', true
        ) as new_common_time,
        -- Calculate intersection of duration ranges
        jsonb_build_object(
          'minValue', GREATEST(
            (gs.common_duration->>'minValue')::numeric,
            (pv.voter_duration->>'minValue')::numeric
          ),
          'maxValue', LEAST(
            (gs.common_duration->>'maxValue')::numeric,
            (pv.voter_duration->>'maxValue')::numeric
          ),
          'minEnabled', true,
          'maxEnabled', true
        ) as new_common_duration
      FROM prioritized_voters pv
      WHERE NOT (pv.vote_id = ANY(gs.selected_ids))
        -- Max participant constraints only (check min at the end)
        AND (pv.max_participants IS NULL OR gs.participant_count + 1 <= pv.max_participants)
        AND NOT EXISTS (
          SELECT 1
          FROM prioritized_voters existing
          WHERE existing.vote_id = ANY(gs.selected_ids)
            AND existing.max_participants IS NOT NULL
            AND gs.participant_count + 1 > existing.max_participants
        )
        -- MULTIDIMENSIONAL CONSTRAINTS:
        -- 1. Must have at least one day in common
        AND EXISTS (
          SELECT 1
          FROM unnest(gs.common_days) d
          WHERE d = ANY(pv.voter_days)
        )
        -- 2. Time windows must overlap (min of new range <= max of new range)
        AND GREATEST(
          (gs.common_time->>'minValue')::time,
          (pv.voter_time->>'minValue')::time
        ) <= LEAST(
          (gs.common_time->>'maxValue')::time,
          (pv.voter_time->>'maxValue')::time
        )
        -- 3. Duration ranges must overlap (min of new range <= max of new range)
        AND GREATEST(
          (gs.common_duration->>'minValue')::numeric,
          (pv.voter_duration->>'minValue')::numeric
        ) <= LEAST(
          (gs.common_duration->>'maxValue')::numeric,
          (pv.voter_duration->>'maxValue')::numeric
        )
      ORDER BY pv.priority_rank ASC
      LIMIT 1
    ) AS next_voter
    WHERE gs.iteration < 100  -- Safety limit
  ),
  -- Get the final selection (most participants)
  final_selection AS (
    SELECT selected_ids, participant_count
    FROM greedy_selection
    ORDER BY participant_count DESC, iteration DESC
    LIMIT 1
  )
-- Return details of selected voters ONLY IF all min constraints are satisfied
SELECT
  pv.vote_id,
  pv.voter_name,
  pv.min_participants,
  pv.max_participants,
  pv.priority_score
FROM prioritized_voters pv
CROSS JOIN final_selection fs
WHERE pv.vote_id = ANY(fs.selected_ids)
  -- Validate that ALL selected voters have their min/max constraints satisfied
  AND NOT EXISTS (
    SELECT 1
    FROM prioritized_voters check_voter
    WHERE check_voter.vote_id = ANY(fs.selected_ids)
      AND (
        (check_voter.min_participants IS NOT NULL AND fs.participant_count < check_voter.min_participants)
        OR (check_voter.max_participants IS NOT NULL AND fs.participant_count > check_voter.max_participants)
      )
  )
ORDER BY pv.priority_score DESC;
$$ LANGUAGE sql STABLE;

-- Add comment explaining the fix
COMMENT ON FUNCTION calculate_participating_voters(UUID) IS
'Calculates which voters participate by greedily selecting voters with compatible constraints across ALL dimensions: days, time windows, duration ranges, and participant counts. Returns the largest set of mutually compatible voters.';
