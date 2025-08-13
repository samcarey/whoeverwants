-- Improve IRV and Borda Count algorithms to handle incomplete ballots from "No Preference" feature

-- 1. Update IRV algorithm to properly handle ballots where all candidates are eliminated
CREATE OR REPLACE FUNCTION calculate_ranked_choice_winner(target_poll_id UUID)
RETURNS TABLE(winner TEXT, total_rounds INT) 
SECURITY DEFINER
AS $$
DECLARE
    current_round INT := 1;
    eliminated_options TEXT[] := ARRAY[]::TEXT[];
    min_votes INT;
    options_to_eliminate TEXT[];
    remaining_options INT;
    total_ballots INT;
    active_ballots INT; -- New: Track ballots still in play
    majority_threshold INT;
    max_votes INT;
    winning_option TEXT;
    tied_candidates TEXT[];
    total_candidates INT;
    was_tie_broken_by_borda BOOLEAN := FALSE;
BEGIN
    -- Clear any existing rounds for this poll
    DELETE FROM ranked_choice_rounds WHERE poll_id = target_poll_id;
    
    -- Get total number of ballots (including those that may become inactive)
    SELECT COUNT(*) INTO total_ballots
    FROM votes 
    WHERE poll_id = target_poll_id 
      AND vote_type = 'ranked_choice'
      AND ranked_choices IS NOT NULL
      AND array_length(ranked_choices, 1) > 0;
    
    -- Get total number of candidates for Borda calculation
    SELECT jsonb_array_length(options) INTO total_candidates
    FROM polls WHERE id = target_poll_id;
    
    -- If no votes, return null
    IF total_ballots = 0 THEN
        RETURN QUERY SELECT NULL::TEXT, 0;
        RETURN;
    END IF;
    
    -- Main elimination loop
    LOOP
        -- Reset tie-breaking flag for this round
        was_tie_broken_by_borda := FALSE;
        
        -- Count ACTIVE ballots (those with at least one non-eliminated candidate)
        SELECT COUNT(*) INTO active_ballots
        FROM votes v
        WHERE v.poll_id = target_poll_id 
          AND v.vote_type = 'ranked_choice'
          AND v.ranked_choices IS NOT NULL
          AND array_length(v.ranked_choices, 1) > 0
          AND EXISTS (
              -- Ballot has at least one non-eliminated candidate
              SELECT 1 FROM unnest(v.ranked_choices) AS choice_option
              WHERE choice_option IS NOT NULL 
                AND choice_option != ''
                AND NOT (choice_option = ANY(eliminated_options))
          );
        
        -- Calculate majority threshold based on ACTIVE ballots
        majority_threshold := (active_ballots / 2) + 1;
        
        -- If no active ballots remain, exit
        IF active_ballots = 0 THEN
            EXIT;
        END IF;
        
        -- Count votes for ALL candidates, including those with 0 votes
        WITH poll_options AS (
            SELECT jsonb_array_elements_text(options) as option_name
            FROM polls WHERE id = target_poll_id
        ),
        active_options AS (
            SELECT option_name 
            FROM poll_options 
            WHERE NOT (option_name = ANY(eliminated_options))
        ),
        vote_counts AS (
            SELECT 
                option_name,
                COUNT(*) as vote_count
            FROM (
                -- For each ACTIVE ballot, find the highest-ranked non-eliminated option
                SELECT DISTINCT ON (v.id)
                    v.id as ballot_id,
                    choice_option as option_name
                FROM votes v,
                     unnest(v.ranked_choices) WITH ORDINALITY AS choices(choice_option, choice_rank)
                WHERE v.poll_id = target_poll_id 
                  AND v.vote_type = 'ranked_choice'
                  AND v.ranked_choices IS NOT NULL
                  AND array_length(v.ranked_choices, 1) > 0
                  AND choice_option IS NOT NULL
                  AND choice_option != ''
                  AND NOT (choice_option = ANY(eliminated_options))
                  -- Only count ballots that have at least one valid choice
                  AND EXISTS (
                      SELECT 1 FROM unnest(v.ranked_choices) AS valid_choice
                      WHERE valid_choice IS NOT NULL 
                        AND valid_choice != ''
                        AND NOT (valid_choice = ANY(eliminated_options))
                  )
                ORDER BY v.id, choice_rank
            ) ballot_top_choices
            GROUP BY option_name
        )
        -- Insert ALL active candidates, including those with 0 votes
        INSERT INTO ranked_choice_rounds (poll_id, round_number, option_name, vote_count, is_eliminated)
        SELECT 
            target_poll_id,
            current_round,
            a.option_name,
            COALESCE(v.vote_count, 0) as vote_count,
            FALSE
        FROM active_options a
        LEFT JOIN vote_counts v USING (option_name);
        
        -- Check if we have a winner (majority of ACTIVE votes)
        SELECT option_name, vote_count INTO winning_option, max_votes
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round
        ORDER BY vote_count DESC
        LIMIT 1;
        
        -- Get remaining options count
        SELECT COUNT(*) INTO remaining_options
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round;
        
        -- Exit conditions:
        -- 1. Winner has majority of ACTIVE votes
        -- 2. Only one option remains
        -- 3. No options left (safety check)
        IF max_votes >= majority_threshold OR remaining_options <= 1 OR remaining_options = 0 THEN
            EXIT;
        END IF;
        
        -- Find minimum vote count for elimination
        SELECT MIN(vote_count) INTO min_votes
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round;
        
        -- Get all candidates tied for last place (minimum votes)
        SELECT ARRAY_AGG(option_name) INTO tied_candidates
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id 
          AND round_number = current_round 
          AND vote_count = min_votes;
        
        -- If only one candidate has minimum votes, eliminate them
        IF array_length(tied_candidates, 1) = 1 THEN
            options_to_eliminate := tied_candidates;
        ELSE
            -- BORDA COUNT TIE-BREAKING: Calculate Borda scores for tied candidates only
            was_tie_broken_by_borda := TRUE;
            
            WITH borda_scores AS (
                SELECT 
                    tied_candidate,
                    SUM(borda_points) as total_borda_score
                FROM (
                    SELECT 
                        choice_option as tied_candidate,
                        -- Borda points: higher rank = more points
                        -- For n candidates: 1st = n points, 2nd = n-1 points, etc.
                        (total_candidates - choice_rank + 1) as borda_points
                    FROM votes v,
                         unnest(v.ranked_choices) WITH ORDINALITY AS choices(choice_option, choice_rank)
                    WHERE v.poll_id = target_poll_id 
                      AND v.vote_type = 'ranked_choice'
                      AND v.ranked_choices IS NOT NULL
                      AND array_length(v.ranked_choices, 1) > 0
                      AND choice_option = ANY(tied_candidates)
                      AND choice_option IS NOT NULL
                      AND choice_option != ''
                ) borda_calculation
                GROUP BY tied_candidate
            ),
            -- Handle candidates not ranked by any voter (0 Borda points)
            all_tied_with_borda AS (
                SELECT 
                    tc.tied_candidate,
                    COALESCE(bs.total_borda_score, 0) as total_borda_score
                FROM unnest(tied_candidates) AS tc(tied_candidate)
                LEFT JOIN borda_scores bs ON tc.tied_candidate = bs.tied_candidate
            )
            -- Store Borda scores for tied candidates and get elimination candidate
            UPDATE ranked_choice_rounds 
            SET 
                borda_score = atb.total_borda_score,
                tie_broken_by_borda = TRUE
            FROM all_tied_with_borda atb
            WHERE poll_id = target_poll_id 
              AND round_number = current_round 
              AND option_name = atb.tied_candidate;
            
            -- Eliminate the candidate with the LOWEST Borda score (least overall support)
            SELECT ARRAY[tied_candidate] INTO options_to_eliminate
            FROM all_tied_with_borda
            ORDER BY total_borda_score ASC, tied_candidate ASC  -- Secondary sort for deterministic results
            LIMIT 1;
        END IF;
        
        -- Safety check for null array
        IF options_to_eliminate IS NULL THEN
            EXIT;
        END IF;
        
        -- Add to eliminated list
        eliminated_options := eliminated_options || options_to_eliminate;
        
        -- Mark eliminated options in this round
        UPDATE ranked_choice_rounds 
        SET is_eliminated = TRUE
        WHERE poll_id = target_poll_id 
          AND round_number = current_round 
          AND option_name = ANY(options_to_eliminate);
        
        -- Move to next round
        current_round := current_round + 1;
        
        -- Safety check to prevent infinite loops
        IF current_round > 50 THEN
            RAISE EXCEPTION 'Ranked choice calculation exceeded maximum rounds';
        END IF;
        
    END LOOP;
    
    RETURN QUERY SELECT winning_option, current_round;
END;
$$ LANGUAGE plpgsql;

-- 2. Create a full Borda Count voting system function with point compensation
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
    
    -- Get total number of candidates and ballots
    SELECT jsonb_array_length(options) INTO total_candidates
    FROM polls WHERE id = target_poll_id;
    
    SELECT COUNT(*) INTO ballot_count
    FROM votes 
    WHERE poll_id = target_poll_id 
      AND vote_type = 'ranked_choice'
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
    -- Calculate raw Borda scores for each candidate
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

-- 3. Add poll_type field to track whether to use IRV or Borda Count
-- Note: This migration assumes the poll_type already exists, but adds Borda count support

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_ranked_choice_rounds_borda_score 
ON ranked_choice_rounds (poll_id, round_number, borda_score DESC);