-- Complete fix for the calculate_ranked_choice_winner function
-- This version simplifies the vote counting logic to avoid complex CTEs

DROP FUNCTION IF EXISTS calculate_ranked_choice_winner(UUID) CASCADE;

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
    active_ballots INT;
    majority_threshold INT;
    max_votes INT;
    winning_option TEXT;
    total_candidates INT;
BEGIN
    -- Clear any existing rounds for this poll
    DELETE FROM ranked_choice_rounds WHERE poll_id = target_poll_id;
    
    -- Get total number of ballots (excluding abstain votes)
    SELECT COUNT(*) INTO total_ballots
    FROM votes 
    WHERE poll_id = target_poll_id 
      AND vote_type = 'ranked_choice'
      AND (is_abstain IS NULL OR is_abstain = FALSE)
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
          AND (v.is_abstain IS NULL OR v.is_abstain = FALSE)
          AND v.ranked_choices IS NOT NULL
          AND array_length(v.ranked_choices, 1) > 0
          AND EXISTS (
              SELECT 1 FROM unnest(v.ranked_choices) AS choice
              WHERE choice IS NOT NULL 
                AND choice != ''
                AND NOT (choice = ANY(eliminated_options))
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
        first_choice_votes AS (
            -- For each ballot, find the first non-eliminated choice
            SELECT DISTINCT ON (v.id)
                v.id as vote_id,
                (
                    SELECT choice
                    FROM unnest(v.ranked_choices) WITH ORDINALITY AS c(choice, position)
                    WHERE choice IS NOT NULL 
                      AND choice != ''
                      AND NOT (choice = ANY(eliminated_options))
                    ORDER BY position
                    LIMIT 1
                ) as first_choice
            FROM votes v
            WHERE v.poll_id = target_poll_id 
              AND v.vote_type = 'ranked_choice'
              AND (v.is_abstain IS NULL OR v.is_abstain = FALSE)
              AND v.ranked_choices IS NOT NULL
              AND array_length(v.ranked_choices, 1) > 0
        ),
        vote_counts AS (
            SELECT 
                ao.option_name,
                COUNT(fcv.first_choice) as vote_count
            FROM active_options ao
            LEFT JOIN first_choice_votes fcv ON ao.option_name = fcv.first_choice
            GROUP BY ao.option_name
        )
        INSERT INTO ranked_choice_rounds (
            poll_id, 
            round_number, 
            option_name, 
            vote_count, 
            is_eliminated
        )
        SELECT 
            target_poll_id,
            current_round,
            option_name,
            vote_count,
            false
        FROM vote_counts;
        
        -- Check for winner (majority)
        SELECT option_name, vote_count INTO winning_option, max_votes
        FROM ranked_choice_rounds
        WHERE poll_id = target_poll_id
          AND round_number = current_round
        ORDER BY vote_count DESC
        LIMIT 1;
        
        -- Count remaining candidates
        SELECT COUNT(*) INTO remaining_options
        FROM ranked_choice_rounds
        WHERE poll_id = target_poll_id
          AND round_number = current_round;
        
        -- Check if we have a winner
        IF max_votes >= majority_threshold OR remaining_options <= 2 THEN
            -- We have a winner or only 2 candidates left
            RETURN QUERY SELECT winning_option, current_round;
            RETURN;
        END IF;
        
        -- Find minimum vote count for elimination
        SELECT MIN(vote_count) INTO min_votes
        FROM ranked_choice_rounds
        WHERE poll_id = target_poll_id
          AND round_number = current_round;
        
        -- Find all candidates tied for minimum votes
        WITH tied_for_last AS (
            SELECT option_name
            FROM ranked_choice_rounds
            WHERE poll_id = target_poll_id
              AND round_number = current_round
              AND vote_count = min_votes
        )
        SELECT ARRAY_AGG(option_name) INTO options_to_eliminate
        FROM tied_for_last;
        
        -- If multiple candidates tied for last, use Borda count to break tie
        IF array_length(options_to_eliminate, 1) > 1 THEN
            WITH borda_scores AS (
                SELECT 
                    tfl.option_name,
                    COALESCE(SUM(
                        CASE 
                            WHEN array_position(v.ranked_choices, tfl.option_name) IS NOT NULL 
                            THEN total_candidates - array_position(v.ranked_choices, tfl.option_name) + 1
                            ELSE 0
                        END
                    ), 0) as borda_score
                FROM unnest(options_to_eliminate) AS tfl(option_name)
                CROSS JOIN votes v
                WHERE v.poll_id = target_poll_id 
                  AND v.vote_type = 'ranked_choice'
                  AND v.ranked_choices IS NOT NULL
                  AND (v.is_abstain IS NULL OR v.is_abstain = FALSE)
                GROUP BY tfl.option_name
            )
            SELECT ARRAY[option_name] INTO options_to_eliminate
            FROM borda_scores
            ORDER BY borda_score ASC, option_name ASC  -- Alphabetical as final tiebreaker
            LIMIT 1;
            
            -- Update borda_score and tie_broken_by_borda flag
            UPDATE ranked_choice_rounds
            SET tie_broken_by_borda = TRUE
            WHERE poll_id = target_poll_id 
              AND round_number = current_round
              AND option_name = options_to_eliminate[1];
        END IF;
        
        -- Mark as eliminated in the current round
        UPDATE ranked_choice_rounds
        SET is_eliminated = TRUE
        WHERE poll_id = target_poll_id 
          AND round_number = current_round
          AND option_name = options_to_eliminate[1];
        
        -- Add to eliminated list
        eliminated_options := array_cat(eliminated_options, options_to_eliminate);
        
        current_round := current_round + 1;
        
        -- Safety check: prevent infinite loops
        IF current_round > 100 THEN
            RAISE EXCEPTION 'Too many rounds in ranked choice calculation';
        END IF;
    END LOOP;
    
    -- If we get here, no winner found (shouldn't happen)
    RETURN QUERY SELECT NULL::TEXT, current_round - 1;
END;
$$ LANGUAGE plpgsql;