-- Migration 094 down: best-effort restore of participation-poll schema.
--
-- Cannot restore deleted poll/vote rows. Recreates the columns and constraints
-- so that subsequent migrations don't fail; participation polls would need to
-- be re-implemented from scratch to use them.

BEGIN;

-- Recreate vote_structure_valid with the participation branch.
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
     yes_no_choice IS NULL)
);

ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
  CHECK (poll_type IN ('yes_no', 'ranked_choice', 'participation', 'time'));

ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
  CHECK (vote_type IN ('yes_no', 'ranked_choice', 'participation', 'time'));

-- Restore vote columns
ALTER TABLE votes ADD COLUMN IF NOT EXISTS min_participants INTEGER;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS max_participants INTEGER;
ALTER TABLE votes ADD CONSTRAINT votes_min_participants_check
  CHECK (min_participants IS NULL OR min_participants >= 1);
ALTER TABLE votes ADD CONSTRAINT votes_max_min_participants_check
  CHECK (max_participants IS NULL OR min_participants IS NULL OR max_participants >= min_participants);

-- Restore poll columns
ALTER TABLE polls ADD COLUMN IF NOT EXISTS min_participants INTEGER;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS max_participants INTEGER;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_mode TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_value TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_options TEXT[];
ALTER TABLE polls ADD COLUMN IF NOT EXISTS resolved_location TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_mode TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_value TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_options TEXT[];
ALTER TABLE polls ADD COLUMN IF NOT EXISTS resolved_time TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS is_sub_poll BOOLEAN DEFAULT false;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS sub_poll_role TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS parent_participation_poll_id UUID;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_suggestions_deadline_minutes INTEGER;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_preferences_deadline_minutes INTEGER;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_suggestions_deadline_minutes INTEGER;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_preferences_deadline_minutes INTEGER;

ALTER TABLE polls ADD CONSTRAINT polls_min_participants_check
  CHECK (min_participants IS NULL OR min_participants >= 1);
ALTER TABLE polls ADD CONSTRAINT polls_participants_range_check
  CHECK (
    (min_participants IS NULL AND max_participants IS NULL) OR
    (min_participants IS NULL AND max_participants IS NOT NULL) OR
    (min_participants IS NOT NULL AND max_participants IS NULL) OR
    (min_participants IS NOT NULL AND max_participants IS NOT NULL AND max_participants >= min_participants)
  );
ALTER TABLE polls ADD CONSTRAINT polls_location_mode_check
  CHECK (location_mode = ANY (ARRAY['set'::text, 'preferences'::text, 'suggestions'::text]));
ALTER TABLE polls ADD CONSTRAINT polls_time_mode_check
  CHECK (time_mode = ANY (ARRAY['set'::text, 'preferences'::text, 'suggestions'::text]));
ALTER TABLE polls ADD CONSTRAINT polls_sub_poll_role_check
  CHECK (sub_poll_role = ANY (ARRAY['location_preferences'::text, 'location_suggestions'::text, 'time_preferences'::text, 'time_suggestions'::text]));
ALTER TABLE polls ADD CONSTRAINT polls_parent_participation_poll_id_fkey
  FOREIGN KEY (parent_participation_poll_id) REFERENCES polls(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_polls_parent_participation ON polls(parent_participation_poll_id);

COMMIT;
