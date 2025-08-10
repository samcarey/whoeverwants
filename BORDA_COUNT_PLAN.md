# Borda Count Tie-Breaking Implementation Plan

## Overview
Implement Borda count tie-breaking for ranked choice voting to enable comeback mechanics when candidates are tied for last place.

## How Borda Count Works
- **Point Assignment**: For `n` candidates, 1st place = `n` points, 2nd place = `n-1` points, etc.
- **Scoring**: Sum all points across all ballots for each candidate
- **Tie-Breaking**: Eliminate candidate with LOWEST Borda score (least overall support)

## Implementation Details

### Modified Function
Replace `calculate_ranked_choice_winner` in database migrations with Borda count tie-breaking logic.

### Key Changes
1. **Tie Detection**: Check if multiple candidates have minimum votes
2. **Borda Calculation**: Only for tied candidates using formula:
   ```sql
   (total_candidates - choice_rank + 1) as borda_points
   ```
3. **Elimination**: Remove candidate with lowest Borda score instead of all tied candidates

### SQL Implementation
```sql
-- Modified function with Borda count tie-breaking
CREATE OR REPLACE FUNCTION calculate_ranked_choice_winner(target_poll_id UUID)
RETURNS TABLE(winner TEXT, total_rounds INT) 
SECURITY DEFINER
AS $$
DECLARE
    current_round INT := 1;
    eliminated_options TEXT[] := ARRAY[]::TEXT[];
    option_counts RECORD;
    min_votes INT;
    options_to_eliminate TEXT[];
    remaining_options INT;
    total_ballots INT;
    majority_threshold INT;
    max_votes INT;
    winning_option TEXT;
    tied_candidates TEXT[];
    total_candidates INT;
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
    
    -- Get total number of candidates for Borda calculation
    SELECT jsonb_array_length(options) INTO total_candidates
    FROM polls WHERE id = target_poll_id;
    
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
            HAVING option_name IS NOT NULL
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
        
        -- Exit conditions
        IF max_votes >= majority_threshold OR remaining_options <= 1 OR remaining_options = 0 THEN
            EXIT;
        END IF;
        
        -- Find minimum vote count for elimination
        SELECT MIN(vote_count) INTO min_votes
        FROM ranked_choice_rounds 
        WHERE poll_id = target_poll_id AND round_number = current_round;
        
        -- Check if there are ties for last place
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
                ) borda_calculation
                GROUP BY tied_candidate
            )
            -- Eliminate the candidate with the LOWEST Borda score (least overall support)
            SELECT ARRAY[tied_candidate] INTO options_to_eliminate
            FROM borda_scores
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
```

## Example Scenario
**5 candidates (A,B,C,D,E), C and D tied with 8 votes each**

Sample ballots:
- Voter 1: `[A, C, D, B, E]` → C gets 3 points, D gets 2 points  
- Voter 2: `[B, D, C, A, E]` → D gets 4 points, C gets 3 points
- Voter 3: `[C, A, D, B, E]` → C gets 5 points, D gets 3 points

**Result**: C has higher Borda score (11 vs 9), so **D is eliminated** and C gets comeback chance.

## Benefits
- **Comeback Friendly**: Candidates with broader appeal survive ties
- **Fair**: Uses all voter preference information, not just first choices  
- **Deterministic**: Consistent results with alphabetical secondary sort
- **Consensus-Based**: Rewards candidates acceptable to more voters
- **Performance**: Only calculates Borda scores when ties occur

## Implementation Steps
1. Create new migration file: `017_add_borda_count_tie_breaking_up.sql`
2. Replace existing `calculate_ranked_choice_winner` function
3. Test with tie scenarios to verify comeback mechanics
4. Update any frontend code that might display tie-breaking information