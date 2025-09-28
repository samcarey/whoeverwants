-- Fix critical bug: Algorithm must consider ALL candidates, including those with 0 votes
-- Bug: Current algorithm only inserts candidates with >0 votes into ranked_choice_rounds
-- This causes candidates with 0 first-place votes to be ignored instead of eliminated first
-- 
-- Example: Poll with votes ["A","B","C"], ["A","C","B"], ["C","A","B"]
-- Round 1: A=2, C=1, B=0
-- BUG: Only A and C get inserted, algorithm eliminates C instead of B
-- FIX: Insert ALL candidates including B with 0 votes, properly eliminate B first

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
    majority_threshold INT;
    max_votes INT;
    winning_option TEXT;
BEGIN
    -- Clear any existing rounds for this poll
    DELETE FROM ranked_choice_rounds WHERE poll_id = target_poll_id;
    
    -- Get total number of ballots
    SELECT COUNT(*) INTO total_ballots
    FROM votes 
    WHERE poll_id = target_poll_id 
      AND vote_type = 'ranked_choice'
      AND ranked_choices IS NOT NULL
      AND array_length(ranked_choices, 1) > 0;
    
    -- If no votes, return null
    IF total_ballots = 0 THEN
        RETURN QUERY SELECT NULL::TEXT, 0;
        RETURN;
    END IF;
    
    -- Calculate majority threshold (more than half)
    majority_threshold := (total_ballots / 2) + 1;
    
    -- Main elimination loop
    LOOP
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
                -- For each ballot, find the highest-ranked non-eliminated option
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
        
        -- Check if we have a winner (majority of votes)
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
        -- 1. Winner has majority of votes
        -- 2. Only one option remains
        -- 3. No options left (safety check)
        IF max_votes >= majority_threshold OR remaining_options <= 1 OR remaining_options = 0 THEN
            EXIT;
        END IF;
        
        -- Find minimum vote count for elimination
        SELECT MIN(vote_count) INTO min_votes
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round;
        
        -- Get all options with minimum votes (handle ties in last place)
        SELECT ARRAY_AGG(option_name) INTO options_to_eliminate
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id 
          AND round_number = current_round 
          AND vote_count = min_votes;
        
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