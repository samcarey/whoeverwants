-- Revert the function back to original version without SECURITY DEFINER
CREATE OR REPLACE FUNCTION calculate_ranked_choice_winner(target_poll_id UUID)
RETURNS TABLE(winner TEXT, total_rounds INT) AS $$
DECLARE
    current_round INT := 1;
    eliminated_options TEXT[] := ARRAY[]::TEXT[];
    option_counts RECORD;
    min_votes INT;
    options_to_eliminate TEXT[];
    remaining_options TEXT[];
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
        -- Count votes for each option, considering eliminated options
        FOR option_counts IN
            SELECT 
                option_name,
                COUNT(*) as vote_count
            FROM (
                -- For each ballot, find the highest-ranked non-eliminated option
                SELECT DISTINCT ON (v.id)
                    v.id as ballot_id,
                    option_value as option_name
                FROM votes v
                CROSS JOIN LATERAL unnest(v.ranked_choices) WITH ORDINALITY AS t(option_value, rank_position)
                WHERE v.poll_id = target_poll_id 
                  AND v.vote_type = 'ranked_choice'
                  AND NOT (option_value = ANY(eliminated_options))
                ORDER BY v.id, rank_position
            ) ballot_top_choices
            GROUP BY option_name
        LOOP
            -- Insert round results
            INSERT INTO ranked_choice_rounds (poll_id, round_number, option_name, vote_count, is_eliminated)
            VALUES (target_poll_id, current_round, option_counts.option_name, option_counts.vote_count, FALSE);
        END LOOP;
        
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
        IF max_votes >= majority_threshold OR array_length(remaining_options, 1) <= 1 THEN
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