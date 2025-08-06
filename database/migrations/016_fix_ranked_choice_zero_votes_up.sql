-- Final fix for ranked choice algorithm to include options with 0 votes
CREATE OR REPLACE FUNCTION calculate_ranked_choice_winner(target_poll_id UUID)
RETURNS TABLE(winner TEXT, total_rounds INT) AS $$
DECLARE
    current_round INT := 1;
    eliminated_options TEXT[] := ARRAY[]::TEXT[];
    min_votes INT;
    options_to_eliminate TEXT[];
    remaining_options_count INT;
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
    WHERE poll_id = target_poll_id AND vote_type = 'ranked_choice';
    
    -- If no votes, return null
    IF total_ballots = 0 THEN
        RETURN QUERY SELECT NULL::TEXT, 0;
        RETURN;
    END IF;
    
    -- Calculate majority threshold (more than half)
    majority_threshold := (total_ballots / 2) + 1;
    
    -- Main elimination loop
    LOOP
        -- Insert all remaining options with their vote counts for this round
        INSERT INTO ranked_choice_rounds (poll_id, round_number, option_name, vote_count, is_eliminated)
        WITH poll_data AS (
            SELECT options FROM polls WHERE id = target_poll_id
        ),
        all_poll_options AS (
            SELECT jsonb_array_elements_text(options) as option_name
            FROM poll_data
        ),
        remaining_options AS (
            SELECT option_name 
            FROM all_poll_options 
            WHERE NOT (option_name = ANY(eliminated_options))
        ),
        vote_counts AS (
            SELECT 
                option_value as option_name,
                COUNT(*) as vote_count
            FROM (
                -- For each ballot, find the highest-ranked non-eliminated option
                SELECT DISTINCT ON (v.id)
                    v.id as ballot_id,
                    option_value
                FROM votes v
                CROSS JOIN LATERAL unnest(v.ranked_choices) WITH ORDINALITY AS t(option_value, rank_position)
                WHERE v.poll_id = target_poll_id 
                  AND v.vote_type = 'ranked_choice'
                  AND NOT (option_value = ANY(eliminated_options))
                ORDER BY v.id, rank_position
            ) ballot_top_choices
            GROUP BY option_value
        )
        SELECT 
            target_poll_id,
            current_round,
            r.option_name,
            COALESCE(v.vote_count, 0),
            FALSE
        FROM remaining_options r
        LEFT JOIN vote_counts v ON r.option_name = v.option_name;
        
        -- Check if we have a winner (majority of votes)
        SELECT option_name, vote_count INTO winning_option, max_votes
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round
        ORDER BY vote_count DESC
        LIMIT 1;
        
        -- Get remaining options count
        SELECT COUNT(*) INTO remaining_options_count
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round;
        
        -- Exit conditions:
        -- 1. Winner has majority of votes
        -- 2. Only one option remains
        IF max_votes >= majority_threshold OR remaining_options_count <= 1 THEN
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