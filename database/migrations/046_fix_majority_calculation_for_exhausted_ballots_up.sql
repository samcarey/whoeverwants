-- Fix majority calculation to use active ballots instead of total ballots
-- This handles cases where some ballots become exhausted (no active candidates left)

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
    active_ballots INT; -- Track ballots still in play
    majority_threshold INT;
    max_votes INT;
    winning_option TEXT;
    tied_candidates TEXT[];
    total_candidates INT;
    min_borda_score INT;
BEGIN
    -- Clear any existing rounds for this poll
    DELETE FROM ranked_choice_rounds WHERE poll_id = target_poll_id;
    
    -- Get total number of ballots (for reference)
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
        
        -- Calculate majority threshold based on ACTIVE ballots (FIXED)
        majority_threshold := (active_ballots / 2) + 1;
        
        -- If no active ballots remain, exit
        IF active_ballots = 0 THEN
            EXIT;
        END IF;
        
        -- FIXED: Count votes for ALL candidates, including those with 0 votes
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
        
        -- FIXED: Check if we have a winner with proper tie-breaking for selection
        -- When there are ties in vote count, use alphabetical ordering as secondary sort
        SELECT option_name, vote_count INTO winning_option, max_votes
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round
        ORDER BY vote_count DESC, option_name ASC
        LIMIT 1;
        
        -- Get remaining options count
        SELECT COUNT(*) INTO remaining_options
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round;
        
        -- FIXED: Exit conditions - check for majority based on ACTIVE ballots OR only one candidate left
        IF max_votes >= majority_threshold OR remaining_options <= 1 THEN
            EXIT;
        END IF;
        
        -- Continue with elimination logic...
        
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
            WITH borda_scores AS (
                SELECT 
                    bc.tied_candidate,
                    SUM(bc.borda_points) as total_borda_score
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
                ) bc
                GROUP BY bc.tied_candidate
            ),
            -- Handle candidates not ranked by any voter (0 Borda points)
            all_tied_with_borda AS (
                SELECT 
                    tc.tied_candidate,
                    COALESCE(bs.total_borda_score, 0) as total_borda_score
                FROM unnest(tied_candidates) AS tc(tied_candidate)
                LEFT JOIN borda_scores bs ON tc.tied_candidate = bs.tied_candidate
            ),
            -- FIXED: Find minimum Borda score and eliminate alphabetically among only those candidates
            lowest_borda_candidates AS (
                SELECT atb.tied_candidate, atb.total_borda_score
                FROM all_tied_with_borda atb
                WHERE atb.total_borda_score = (SELECT MIN(atb2.total_borda_score) FROM all_tied_with_borda atb2)
            )
            SELECT ARRAY[lbc.tied_candidate] INTO options_to_eliminate
            FROM lowest_borda_candidates lbc
            ORDER BY lbc.tied_candidate DESC  -- Eliminate alphabetically LAST candidate among lowest Borda score candidates
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
        
        -- Store Borda scores in the round data for transparency and mark tie-breaking candidates
        UPDATE ranked_choice_rounds 
        SET borda_score = borda_data.total_borda_score,
            tie_broken_by_borda = CASE 
                WHEN array_length(tied_candidates, 1) > 1 THEN TRUE 
                ELSE FALSE 
            END
        FROM (
            SELECT 
                tc.tied_candidate,
                COALESCE(bs.total_borda_score, 0) as total_borda_score
            FROM unnest(tied_candidates) AS tc(tied_candidate)
            LEFT JOIN (
                SELECT 
                    choice_option as tied_candidate,
                    SUM((total_candidates - choice_rank + 1)) as total_borda_score
                FROM votes v,
                     unnest(v.ranked_choices) WITH ORDINALITY AS choices(choice_option, choice_rank)
                WHERE v.poll_id = target_poll_id 
                  AND v.vote_type = 'ranked_choice'
                  AND v.ranked_choices IS NOT NULL
                  AND array_length(v.ranked_choices, 1) > 0
                  AND choice_option = ANY(tied_candidates)
                  AND choice_option IS NOT NULL
                  AND choice_option != ''
                GROUP BY choice_option
            ) bs ON tc.tied_candidate = bs.tied_candidate
        ) borda_data(tied_candidate, total_borda_score)
        WHERE ranked_choice_rounds.poll_id = target_poll_id 
          AND ranked_choice_rounds.round_number = current_round
          AND ranked_choice_rounds.option_name = borda_data.tied_candidate;
        
        -- Move to next round
        current_round := current_round + 1;
        
        -- Safety check to prevent infinite loops
        IF current_round > 50 THEN
            EXIT;
        END IF;
    END LOOP;
    
    -- Return results
    RETURN QUERY SELECT winning_option, current_round;
END;
$$ LANGUAGE plpgsql;