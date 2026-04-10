-- Replace IRV ranking with like/dislike reactions for time poll preferences.
-- Voters tap slots to mark them liked (green) or disliked (red); neutral is the default.

ALTER TABLE votes ADD COLUMN IF NOT EXISTS liked_slots jsonb;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS disliked_slots jsonb;

-- Update vote_structure_valid to allow liked/disliked reactions for time poll preferences.
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
    (vote_type = 'yes_no' AND
     ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
     ranked_choices IS NULL AND
     suggestions IS NULL) OR
    (vote_type = 'participation' AND
     ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
     ranked_choices IS NULL AND
     suggestions IS NULL) OR
    (vote_type = 'ranked_choice' AND
     yes_no_choice IS NULL AND
     (
       ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) OR
       (suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
       (is_abstain = true AND ranked_choices IS NULL AND (suggestions IS NULL OR array_length(suggestions, 1) IS NULL))
     )) OR
    (vote_type = 'time' AND
     yes_no_choice IS NULL AND
     suggestions IS NULL AND
     (
       (voter_day_time_windows IS NOT NULL AND is_abstain = false) OR
       (liked_slots IS NOT NULL AND is_abstain = false) OR
       (disliked_slots IS NOT NULL AND is_abstain = false) OR
       (is_abstain = true)
     ))
);
