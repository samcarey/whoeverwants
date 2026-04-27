-- Migration 094: Completely remove the participation poll type.
--
-- Participation polls are deleted (CASCADE drops their votes + sub-polls).
-- All participation-only columns on `polls` and `votes` are dropped.
-- The poll_type / vote_type CHECK constraints are recreated without
-- 'participation'. The vote_structure_valid CHECK is recreated without the
-- participation branch. Participation-only sub-poll role / location_mode /
-- time_mode CHECK constraints are dropped along with their columns.
--
-- This migration is destructive and one-way. The `_down.sql` file is a
-- best-effort schema restore (re-adds NULL columns and CHECK constraints)
-- but cannot recover deleted data.

BEGIN;

-- 0. Drop the legacy auto-close trigger + function. Migration 064 was meant
--    to drop these but they survived on some DBs (the function references
--    `polls.max_participants`, which step 3 below deletes — leaving the
--    trigger in place would break every subsequent INSERT into votes).
DROP TRIGGER IF EXISTS check_participation_capacity ON votes;
DROP FUNCTION IF EXISTS auto_close_participation_poll();

-- 1. Delete every participation poll (and any orphaned location/time
--    sub-polls). Step 1 alone CASCADEs to votes + sub-polls via the FKs;
--    the OR is_sub_poll = true clause is defensive in case any sub-poll row
--    survived outside the FK relationship.
DELETE FROM polls WHERE poll_type = 'participation' OR is_sub_poll = true;

-- 2. Drop participation-only CHECK constraints + indexes on `polls`.
ALTER TABLE polls
    DROP CONSTRAINT IF EXISTS polls_min_participants_check,
    DROP CONSTRAINT IF EXISTS polls_participants_range_check,
    DROP CONSTRAINT IF EXISTS polls_location_mode_check,
    DROP CONSTRAINT IF EXISTS polls_time_mode_check,
    DROP CONSTRAINT IF EXISTS polls_sub_poll_role_check,
    DROP CONSTRAINT IF EXISTS polls_parent_participation_poll_id_fkey;
DROP INDEX IF EXISTS idx_polls_parent_participation;

-- 3. Drop participation-only columns on `polls`. Reference location fields
--    (reference_latitude/longitude/label), day_time_windows, duration_window,
--    and min_availability_percent are kept — time polls use them.
ALTER TABLE polls
    DROP COLUMN IF EXISTS min_participants,
    DROP COLUMN IF EXISTS max_participants,
    DROP COLUMN IF EXISTS location_mode,
    DROP COLUMN IF EXISTS location_value,
    DROP COLUMN IF EXISTS location_options,
    DROP COLUMN IF EXISTS resolved_location,
    DROP COLUMN IF EXISTS time_mode,
    DROP COLUMN IF EXISTS time_value,
    DROP COLUMN IF EXISTS time_options,
    DROP COLUMN IF EXISTS resolved_time,
    DROP COLUMN IF EXISTS is_sub_poll,
    DROP COLUMN IF EXISTS sub_poll_role,
    DROP COLUMN IF EXISTS parent_participation_poll_id,
    DROP COLUMN IF EXISTS location_suggestions_deadline_minutes,
    DROP COLUMN IF EXISTS location_preferences_deadline_minutes,
    DROP COLUMN IF EXISTS time_suggestions_deadline_minutes,
    DROP COLUMN IF EXISTS time_preferences_deadline_minutes;

-- 4. Drop participation-only columns + constraints on `votes`.
ALTER TABLE votes
    DROP CONSTRAINT IF EXISTS votes_min_participants_check,
    DROP CONSTRAINT IF EXISTS votes_max_min_participants_check,
    DROP COLUMN IF EXISTS min_participants,
    DROP COLUMN IF EXISTS max_participants;

-- 5. Recreate the poll_type / vote_type CHECK constraints without
--    'participation'. (These were dropped in earlier migration churn on prod
--    but may still exist on dev/test envs — DROP IF EXISTS is defensive.)
ALTER TABLE polls
    DROP CONSTRAINT IF EXISTS polls_poll_type_check,
    DROP CONSTRAINT IF EXISTS poll_type_check,
    ADD CONSTRAINT polls_poll_type_check
        CHECK (poll_type IN ('yes_no', 'ranked_choice', 'time'));

ALTER TABLE votes
    DROP CONSTRAINT IF EXISTS votes_vote_type_check,
    DROP CONSTRAINT IF EXISTS vote_type_check,
    ADD CONSTRAINT votes_vote_type_check
        CHECK (vote_type IN ('yes_no', 'ranked_choice', 'time'));

-- 6. Recreate vote_structure_valid without the participation branch.
ALTER TABLE votes
    DROP CONSTRAINT IF EXISTS vote_structure_valid,
    ADD CONSTRAINT vote_structure_valid CHECK (
        (vote_type = 'yes_no' AND
         ((yes_no_choice IS NOT NULL AND is_abstain = false) OR (yes_no_choice IS NULL AND is_abstain = true)) AND
         ranked_choices IS NULL AND
         suggestions IS NULL) OR
        (vote_type = 'ranked_choice' AND
         yes_no_choice IS NULL AND
         (
           -- Standard ranked_choice: has rankings, no suggestions
           ((ranked_choices IS NOT NULL AND is_abstain = false) OR (ranked_choices IS NULL AND is_abstain = true)) OR
           -- Suggestion phase: has suggestions (rankings optional)
           (suggestions IS NOT NULL AND array_length(suggestions, 1) > 0 AND is_abstain = false) OR
           -- Suggestion phase abstain
           (is_abstain = true AND ranked_choices IS NULL AND (suggestions IS NULL OR array_length(suggestions, 1) IS NULL))
         )) OR
        (vote_type = 'time' AND
         yes_no_choice IS NULL)
    );

COMMIT;
