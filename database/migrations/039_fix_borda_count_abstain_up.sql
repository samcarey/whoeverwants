-- Fix Borda count function to also handle abstain votes
CREATE OR REPLACE FUNCTION calculate_borda_count_winner(target_poll_id UUID)
RETURNS TABLE(winner TEXT, candidate_name TEXT, borda_score INTEGER, total_ballots INTEGER) 
SECURITY DEFINER
AS $$
DECLARE
    total_candidates INT;
    ballot_count INT;
    winning_candidate TEXT;
    winning_score INT;
BEGIN
    -- Clear any existing Borda count results for this poll
    DELETE FROM ranked_choice_rounds WHERE poll_id = target_poll_id;
    
    -- Get total number of candidates and ballots (excluding abstain votes)
    SELECT jsonb_array_length(options) INTO total_candidates
    FROM polls WHERE id = target_poll_id;
    
    SELECT COUNT(*) INTO ballot_count
    FROM votes 
    WHERE poll_id = target_poll_id 
      AND vote_type = 'ranked_choice'
      AND (is_abstain IS NULL OR is_abstain = FALSE)
      AND ranked_choices IS NOT NULL
      AND array_length(ranked_choices, 1) > 0;
    
    -- If no votes, return null
    IF ballot_count = 0 THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::INTEGER, 0;
        RETURN;
    END IF;
    
    -- Calculate compensated Borda scores
    WITH poll_options AS (
        SELECT jsonb_array_elements_text(options) as option_name
        FROM polls WHERE id = target_poll_id
    ),
    -- Calculate raw Borda scores for each candidate (excluding abstain votes)
    raw_borda_scores AS (
        SELECT 
            choice_option as candidate_name,
            choice_rank,
            -- Standard Borda points: n-rank+1 where n = total candidates
            (total_candidates - choice_rank + 1) as standard_points,
            -- Count how many candidates were ranked in this ballot
            array_length(v.ranked_choices, 1) as ballot_length
        FROM votes v,
             unnest(v.ranked_choices) WITH ORDINALITY AS choices(choice_option, choice_rank)
        WHERE v.poll_id = target_poll_id 
          AND v.vote_type = 'ranked_choice'
          AND (v.is_abstain IS NULL OR v.is_abstain = FALSE)
          AND v.ranked_choices IS NOT NULL
          AND array_length(v.ranked_choices, 1) > 0
          AND choice_option IS NOT NULL
          AND choice_option != ''
    ),
    -- Apply compensation formula for fair comparison across incomplete ballots
    compensated_scores AS (
        SELECT 
            rbs.candidate_name,
            -- Compensation formula: scale points so each ballot contributes equally
            -- For ballot with k candidates: scale factor = total_candidates / k
            -- This ensures each ballot's total contribution is normalized
            ROUND(
                rbs.standard_points * (total_candidates::FLOAT / rbs.ballot_length::FLOAT)
            )::INTEGER as compensated_points
        FROM raw_borda_scores rbs
    ),
    -- Sum up all compensated points for each candidate
    candidate_totals AS (
        SELECT 
            cs.candidate_name,
            SUM(cs.compensated_points) as total_borda_score
        FROM compensated_scores cs
        GROUP BY cs.candidate_name
    ),
    -- Include all poll options, even those not ranked by anyone
    all_candidates_with_scores AS (
        SELECT 
            po.option_name as candidate_name,
            COALESCE(ct.total_borda_score, 0) as total_borda_score
        FROM poll_options po
        LEFT JOIN candidate_totals ct ON po.option_name = ct.candidate_name
    )
    -- Insert results into ranked_choice_rounds table for consistency
    INSERT INTO ranked_choice_rounds (poll_id, round_number, option_name, vote_count, borda_score, is_eliminated)
    SELECT 
        target_poll_id,
        1, -- Borda count is single-round
        acws.candidate_name,
        0, -- vote_count not applicable for Borda
        acws.total_borda_score,
        FALSE
    FROM all_candidates_with_scores acws;
    
    -- Determine the winner (highest Borda score)
    SELECT r.option_name, r.borda_score INTO winning_candidate, winning_score
    FROM ranked_choice_rounds r
    WHERE r.poll_id = target_poll_id AND r.round_number = 1
    ORDER BY r.borda_score DESC, r.option_name ASC -- Secondary sort for deterministic results
    LIMIT 1;
    
    -- Return all candidates with their scores and the winner
    RETURN QUERY 
    SELECT 
        CASE WHEN r.option_name = winning_candidate THEN winning_candidate ELSE NULL END as winner,
        r.option_name as candidate_name,
        r.borda_score,
        ballot_count as total_ballots
    FROM ranked_choice_rounds r
    WHERE r.poll_id = target_poll_id AND r.round_number = 1
    ORDER BY r.borda_score DESC, r.option_name ASC;
END;
$$ LANGUAGE plpgsql;