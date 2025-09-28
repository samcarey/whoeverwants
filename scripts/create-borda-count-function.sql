-- Create the calculate_borda_count_winner function for Borda count compensation

CREATE OR REPLACE FUNCTION calculate_borda_count_winner(target_poll_id UUID)
RETURNS TABLE(winner TEXT, total_score NUMERIC) 
SECURITY DEFINER
AS $$
DECLARE
    total_candidates INT;
    max_points NUMERIC;
BEGIN
    -- Get total number of candidates
    SELECT jsonb_array_length(options) INTO total_candidates
    FROM polls WHERE id = target_poll_id;
    
    -- Maximum points a ballot can contribute
    max_points := (total_candidates * (total_candidates + 1))::NUMERIC / 2;
    
    -- Calculate compensated Borda scores
    RETURN QUERY
    WITH ballot_scores AS (
        -- For each ballot, calculate raw points and compensation factor
        SELECT 
            v.id as vote_id,
            v.ranked_choices,
            array_length(v.ranked_choices, 1) as ballot_length,
            -- Compensation factor to normalize ballot contribution
            CASE 
                WHEN array_length(v.ranked_choices, 1) > 0
                THEN max_points / ((array_length(v.ranked_choices, 1) * (array_length(v.ranked_choices, 1) + 1))::NUMERIC / 2)
                ELSE 0
            END as compensation_factor
        FROM votes v
        WHERE v.poll_id = target_poll_id 
          AND v.vote_type = 'ranked_choice'
          AND (v.is_abstain IS NULL OR v.is_abstain = FALSE)
          AND v.ranked_choices IS NOT NULL
          AND array_length(v.ranked_choices, 1) > 0
    ),
    expanded_scores AS (
        SELECT 
            choice,
            position,
            ballot_length,
            compensation_factor
        FROM ballot_scores bs,
             unnest(bs.ranked_choices) WITH ORDINALITY AS t(choice, position)
    ),
    candidate_scores AS (
        SELECT 
            choice as candidate,
            SUM((ballot_length - position::INT + 1) * compensation_factor) as total_borda_score
        FROM expanded_scores
        GROUP BY choice
    )
    SELECT 
        candidate as winner,
        total_borda_score as total_score
    FROM candidate_scores
    ORDER BY total_borda_score DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;