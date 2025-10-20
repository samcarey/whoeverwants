-- Fix time generation in time slot calculation
-- generate_series doesn't work with TIME type, need to use timestamp approach

CREATE OR REPLACE FUNCTION calculate_optimal_time_slot_rounds(poll_id_param UUID)
RETURNS TABLE (
  round_number INTEGER,
  slot_date DATE,
  slot_start_time TIME,
  slot_end_time TIME,
  duration_hours NUMERIC,
  participant_count INTEGER,
  participant_vote_ids UUID[],
  participant_names TEXT[]
) AS $$
DECLARE
  poll_rec RECORD;
  slot_rec RECORD;
  current_round INTEGER := 1;
  prev_count INTEGER := NULL;
BEGIN
  -- Load poll constraints
  SELECT
    possible_days,
    duration_window,
    time_window,
    min_participants,
    max_participants
  INTO poll_rec
  FROM polls
  WHERE id = poll_id_param;

  -- Return empty if no conditions specified
  IF poll_rec.possible_days IS NULL THEN
    RETURN;
  END IF;

  -- Generate all candidate slots and calculate participants
  FOR slot_rec IN
    WITH
      -- Unnest dates
      candidate_dates AS (
        SELECT d::DATE as event_date
        FROM unnest(poll_rec.possible_days) as d
        WHERE d::DATE >= CURRENT_DATE
      ),
      -- Generate durations
      candidate_durations AS (
        SELECT dur::numeric as duration_hours
        FROM generate_series(
          COALESCE(
            CASE WHEN (poll_rec.duration_window->>'minEnabled')::boolean
              THEN (poll_rec.duration_window->>'minValue')::numeric
              ELSE 0.25
            END,
            0.25
          ),
          COALESCE(
            CASE WHEN (poll_rec.duration_window->>'maxEnabled')::boolean
              THEN (poll_rec.duration_window->>'maxValue')::numeric
              ELSE 24
            END,
            24
          ),
          0.25
        ) as dur
      ),
      -- Generate start times using timestamp approach
      candidate_start_times AS (
        SELECT (ts::time) as start_time
        FROM generate_series(
          ('2000-01-01 ' || COALESCE(
            CASE WHEN (poll_rec.time_window->>'minEnabled')::boolean
              THEN (poll_rec.time_window->>'minValue')::text
              ELSE '00:00'
            END,
            '00:00'
          ))::timestamp,
          ('2000-01-01 ' || COALESCE(
            CASE WHEN (poll_rec.time_window->>'maxEnabled')::boolean
              THEN (poll_rec.time_window->>'maxValue')::text
              ELSE '23:45'
            END,
            '23:45'
          ))::timestamp,
          interval '15 minutes'
        ) as ts
      ),
      -- Cartesian product of all combinations
      all_candidate_slots AS (
        SELECT
          cd.event_date,
          cst.start_time,
          (cst.start_time + (cdur.duration_hours * interval '1 hour'))::time as end_time,
          cdur.duration_hours
        FROM candidate_dates cd
        CROSS JOIN candidate_start_times cst
        CROSS JOIN candidate_durations cdur
        WHERE
          -- Filter: end_time must not exceed time_window
          (poll_rec.time_window IS NULL
           OR (poll_rec.time_window->>'maxEnabled')::boolean = false
           OR (cst.start_time + (cdur.duration_hours * interval '1 hour'))::time <= (poll_rec.time_window->>'maxValue')::time)
      ),
      -- Calculate participants for each slot
      slot_participants AS (
        SELECT
          acs.event_date,
          acs.start_time,
          acs.end_time,
          acs.duration_hours,
          COALESCE(array_length(greedy.selected_ids, 1), 0) as participant_count,
          COALESCE(greedy.selected_ids, ARRAY[]::uuid[]) as participant_vote_ids,
          COALESCE(greedy.participant_names, ARRAY[]::text[]) as participant_names
        FROM all_candidate_slots acs
        CROSS JOIN LATERAL (
          -- Greedy selection for this specific slot
          WITH RECURSIVE
            prioritized_voters AS (
              SELECT
                v.id as vote_id,
                v.voter_name,
                v.min_participants,
                v.max_participants,
                CASE
                  WHEN v.max_participants IS NULL THEN 1000000::BIGINT
                  ELSE v.max_participants::BIGINT
                END * 1000000
                - COALESCE(v.min_participants, 0) * 1000
                - EXTRACT(EPOCH FROM v.created_at)::BIGINT AS priority_score,
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
                AND (v.voter_days IS NULL OR acs.event_date::text = ANY(v.voter_days))
                AND (v.voter_duration IS NULL
                     OR ((v.voter_duration->>'minEnabled')::boolean = false OR acs.duration_hours >= (v.voter_duration->>'minValue')::numeric)
                     AND ((v.voter_duration->>'maxEnabled')::boolean = false OR acs.duration_hours <= (v.voter_duration->>'maxValue')::numeric))
                AND (v.voter_time IS NULL
                     OR ((v.voter_time->>'minEnabled')::boolean = false OR acs.start_time >= (v.voter_time->>'minValue')::time)
                     AND ((v.voter_time->>'maxEnabled')::boolean = false OR acs.end_time <= (v.voter_time->>'maxValue')::time))
            ),
            greedy_selection AS (
              SELECT
                1 as iteration,
                ARRAY[pv.vote_id] as selected_ids,
                ARRAY[pv.voter_name] as names,
                1 as count
              FROM prioritized_voters pv
              WHERE pv.priority_rank = 1
                AND (pv.min_participants IS NULL OR 1 >= pv.min_participants)
                AND (pv.max_participants IS NULL OR 1 <= pv.max_participants)

              UNION ALL

              SELECT
                gs.iteration + 1,
                gs.selected_ids || next_voter.vote_id,
                gs.names || next_voter.voter_name,
                gs.count + 1
              FROM greedy_selection gs
              CROSS JOIN LATERAL (
                SELECT pv.*
                FROM prioritized_voters pv
                WHERE NOT (pv.vote_id = ANY(gs.selected_ids))
                  AND (pv.min_participants IS NULL OR gs.count + 1 >= pv.min_participants)
                  AND (pv.max_participants IS NULL OR gs.count + 1 <= pv.max_participants)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM prioritized_voters existing
                    WHERE existing.vote_id = ANY(gs.selected_ids)
                      AND existing.max_participants IS NOT NULL
                      AND gs.count + 1 > existing.max_participants
                  )
                ORDER BY pv.priority_rank ASC
                LIMIT 1
              ) AS next_voter
              WHERE gs.iteration < 100
            ),
            final_selection AS (
              SELECT selected_ids, names
              FROM greedy_selection
              ORDER BY count DESC
              LIMIT 1
            )
          SELECT
            fs.selected_ids,
            fs.names as participant_names
          FROM final_selection fs
        ) as greedy
        WHERE COALESCE(array_length(greedy.selected_ids, 1), 0) > 0
      ),
      -- Deduplicate overlapping slots
      deduplicated_slots AS (
        SELECT DISTINCT ON (sp.event_date, sp.participant_count, sp.start_time)
          sp.event_date,
          sp.start_time,
          sp.end_time,
          sp.duration_hours,
          sp.participant_count,
          sp.participant_vote_ids,
          sp.participant_names
        FROM slot_participants sp
        ORDER BY
          sp.event_date,
          sp.participant_count,
          sp.start_time,
          sp.duration_hours DESC
      )
    SELECT
      ds.event_date,
      ds.start_time,
      ds.end_time,
      ds.duration_hours,
      ds.participant_count,
      ds.participant_vote_ids,
      ds.participant_names
    FROM deduplicated_slots ds
    ORDER BY
      ds.participant_count DESC,
      ds.event_date ASC,
      ds.start_time ASC
  LOOP
    -- Assign round numbers based on participant count changes
    IF prev_count IS NOT NULL AND slot_rec.participant_count < prev_count THEN
      current_round := current_round + 1;
    END IF;

    round_number := current_round;
    slot_date := slot_rec.event_date;
    slot_start_time := slot_rec.start_time;
    slot_end_time := slot_rec.end_time;
    duration_hours := slot_rec.duration_hours;
    participant_count := slot_rec.participant_count;
    participant_vote_ids := slot_rec.participant_vote_ids;
    participant_names := slot_rec.participant_names;

    RETURN NEXT;

    prev_count := slot_rec.participant_count;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_optimal_time_slot_rounds IS
'Fixed version: Uses timestamp-based generation for time series to avoid generate_series TIME limitation.';
