-- Drop existing function if it exists
DROP FUNCTION IF EXISTS calculate_borda_count_winner(UUID);

-- Create improved Borda Count function with point compensation
CREATE OR REPLACE FUNCTION calculate_borda_count_winner(target_poll_id UUID)
RETURNS TABLE(
    candidate_name TEXT,
    borda_score NUMERIC,
    winner TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    total_candidates INTEGER;
    max_score NUMERIC;
    winning_candidate TEXT;
    poll_options JSONB;
BEGIN
    -- Get total number of candidates in the poll
    SELECT options, jsonb_array_length(options) 
    INTO poll_options, total_candidates
    FROM polls
    WHERE id = target_poll_id;
    
    IF total_candidates IS NULL OR total_candidates = 0 THEN
        RETURN;
    END IF;
    
    -- Calculate Borda scores with compensation
    -- Each ballot should contribute equally, regardless of how many candidates it ranks
    CREATE TEMP TABLE borda_scores ON COMMIT DROP AS
    WITH vote_scores AS (
        SELECT 
            v.id as vote_id,
            unnest(v.ranked_choices) as candidate,
            array_length(v.ranked_choices, 1) as ballot_length,
            generate_series(
                array_length(v.ranked_choices, 1),
                1,
                -1
            ) as position_score
        FROM votes v
        WHERE v.poll_id = target_poll_id
          AND v.vote_type = 'ranked_choice'
          AND v.ranked_choices IS NOT NULL
          AND array_length(v.ranked_choices, 1) > 0
    ),
    compensated_scores AS (
        SELECT
            candidate,
            vote_id,
            -- Apply compensation factor: total_candidates / ballot_length
            -- This ensures each ballot contributes equally
            position_score * (total_candidates::NUMERIC / ballot_length::NUMERIC) as compensated_score
        FROM vote_scores
    ),
    candidate_totals AS (
        SELECT
            candidate,
            SUM(compensated_score) as total_score
        FROM compensated_scores
        GROUP BY candidate
    ),
    all_candidates AS (
        SELECT jsonb_array_element_text(poll_options, generate_series(0, total_candidates - 1)) as option_value
    )
    SELECT
        ac.option_value as candidate,
        COALESCE(ct.total_score, 0) as score
    FROM all_candidates ac
    LEFT JOIN candidate_totals ct ON ct.candidate = ac.option_value;
    
    -- Find the winner (candidate with highest score)
    SELECT candidate, score INTO winning_candidate, max_score
    FROM borda_scores
    ORDER BY score DESC
    LIMIT 1;
    
    -- Return results for all candidates
    RETURN QUERY
    SELECT 
        bs.candidate as candidate_name,
        bs.score as borda_score,
        CASE 
            WHEN bs.candidate = winning_candidate THEN bs.candidate
            ELSE NULL
        END as winner
    FROM borda_scores bs
    ORDER BY bs.score DESC;
    
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION calculate_borda_count_winner(UUID) TO anon;
GRANT EXECUTE ON FUNCTION calculate_borda_count_winner(UUID) TO authenticated;