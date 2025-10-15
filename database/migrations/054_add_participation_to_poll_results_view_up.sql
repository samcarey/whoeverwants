-- Update poll_results view to include participation poll type
-- Participation polls use the same vote structure as yes/no polls
-- Need to calculate yes_count and no_count for participation type

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
    -- Yes/No and Participation poll aggregation
    CASE
        WHEN p.poll_type IN ('yes_no', 'participation') THEN
            COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END)
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
        WHEN p.poll_type IN ('yes_no', 'participation') AND COUNT(v.id) > 0 THEN
            ROUND((COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END)::DECIMAL / COUNT(v.id)) * 100)
        ELSE NULL
    END as yes_percentage,
    CASE
        WHEN p.poll_type IN ('yes_no', 'participation') AND COUNT(v.id) > 0 THEN
            ROUND((COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END)::DECIMAL / COUNT(v.id)) * 100)
        ELSE NULL
    END as no_percentage,
    -- Winner determination for yes/no, participation, and ranked choice polls
    CASE
        WHEN p.poll_type IN ('yes_no', 'participation') THEN
            CASE
                WHEN COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END) > COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END) THEN 'yes'
                WHEN COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END) > COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END) THEN 'no'
                ELSE 'tie'
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
