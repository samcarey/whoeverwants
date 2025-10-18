-- Create a function to calculate valid participation votes
-- Only counts "yes" votes where the voter's min/max conditions are met

CREATE OR REPLACE FUNCTION calculate_valid_participation_votes(poll_id_param UUID)
RETURNS TABLE (
  valid_yes_count INTEGER,
  total_yes_count INTEGER,
  conditions_met BOOLEAN
) AS $$
DECLARE
  total_yes INTEGER;
  valid_count INTEGER;
BEGIN
  -- First, get the total number of "yes" votes
  SELECT COUNT(*)
  INTO total_yes
  FROM votes
  WHERE poll_id = poll_id_param
    AND vote_type = 'participation'
    AND yes_no_choice = 'yes'
    AND is_abstain = false;

  -- Count how many "yes" votes have their conditions met
  -- A vote's conditions are met if:
  -- 1. The total yes count >= their min_participants (or min is null)
  -- 2. The total yes count <= their max_participants (or max is null)
  SELECT COUNT(*)
  INTO valid_count
  FROM votes
  WHERE poll_id = poll_id_param
    AND vote_type = 'participation'
    AND yes_no_choice = 'yes'
    AND is_abstain = false
    AND (min_participants IS NULL OR total_yes >= min_participants)
    AND (max_participants IS NULL OR total_yes <= max_participants);

  -- The event happens if all "yes" voters have their conditions met
  RETURN QUERY SELECT
    valid_count::INTEGER,
    total_yes::INTEGER,
    (valid_count = total_yes AND total_yes > 0)::BOOLEAN;
END;
$$ LANGUAGE plpgsql STABLE;

-- Update poll_results view to use the new conditional counting for participation polls
DROP VIEW IF EXISTS poll_results;

CREATE VIEW poll_results AS
SELECT
    p.id as poll_id,
    p.title,
    p.poll_type,
    p.created_at,
    p.response_deadline,
    p.options,
    p.min_participants,
    p.max_participants,
    -- Yes/No poll aggregation (unchanged)
    CASE
        WHEN p.poll_type = 'yes_no' THEN
            COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END)
        -- Participation polls: use conditional counting
        WHEN p.poll_type = 'participation' THEN
            (SELECT valid_yes_count FROM calculate_valid_participation_votes(p.id))
        ELSE NULL
    END as yes_count,
    CASE
        WHEN p.poll_type IN ('yes_no', 'participation') THEN
            COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END)
        ELSE NULL
    END as no_count,
    -- Total vote count for all poll types
    COUNT(v.id) as total_votes,
    -- Calculated percentages for yes/no and participation polls
    CASE
        WHEN p.poll_type = 'yes_no' AND COUNT(v.id) > 0 THEN
            ROUND((COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END)::DECIMAL / COUNT(v.id)) * 100)
        WHEN p.poll_type = 'participation' AND COUNT(v.id) > 0 THEN
            ROUND(((SELECT valid_yes_count FROM calculate_valid_participation_votes(p.id))::DECIMAL / COUNT(v.id)) * 100)
        ELSE NULL
    END as yes_percentage,
    CASE
        WHEN p.poll_type IN ('yes_no', 'participation') AND COUNT(v.id) > 0 THEN
            ROUND((COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END)::DECIMAL / COUNT(v.id)) * 100)
        ELSE NULL
    END as no_percentage,
    -- Winner determination for yes/no, participation, and ranked choice polls
    CASE
        WHEN p.poll_type = 'yes_no' THEN
            CASE
                WHEN COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END) > COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END) THEN 'yes'
                WHEN COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END) > COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END) THEN 'no'
                ELSE 'tie'
            END
        WHEN p.poll_type = 'participation' THEN
            CASE
                -- Event happens only if all yes voters have their conditions met
                WHEN (SELECT conditions_met FROM calculate_valid_participation_votes(p.id)) THEN 'yes'
                ELSE 'no'
            END
        WHEN p.poll_type = 'ranked_choice' THEN
            -- Get winner from the final round of ranked choice results
            (
                WITH final_round AS (
                    SELECT
                        rcr.option_name,
                        rcr.vote_count
                    FROM ranked_choice_rounds rcr
                    WHERE rcr.poll_id = p.id
                        AND rcr.round_number = (
                            SELECT MAX(round_number)
                            FROM ranked_choice_rounds
                            WHERE poll_id = p.id
                        )
                        AND NOT rcr.is_eliminated
                ),
                max_votes AS (
                    SELECT MAX(vote_count) as max_vote_count
                    FROM final_round
                ),
                winners AS (
                    SELECT fr.option_name, fr.vote_count
                    FROM final_round fr
                    CROSS JOIN max_votes mv
                    WHERE fr.vote_count = mv.max_vote_count
                )
                SELECT
                    CASE
                        -- Check for ties: multiple candidates with same highest vote count
                        WHEN COUNT(*) > 1 THEN 'tie'
                        -- Single winner case: return the winner's name
                        ELSE MIN(option_name)
                    END
                FROM winners
            )
        ELSE NULL
    END as winner,
    -- Total rounds for ranked choice polls
    CASE
        WHEN p.poll_type = 'ranked_choice' THEN
            (SELECT MAX(round_number) FROM ranked_choice_rounds WHERE poll_id = p.id)
        ELSE NULL
    END as total_rounds
FROM polls p
LEFT JOIN votes v ON p.id = v.poll_id AND v.vote_type = p.poll_type
GROUP BY p.id, p.title, p.poll_type, p.created_at, p.response_deadline, p.options, p.min_participants, p.max_participants;

-- Grant access to the view
GRANT SELECT ON poll_results TO public;

-- Enable Row Level Security on the view
ALTER VIEW poll_results SET (security_invoker = true);
