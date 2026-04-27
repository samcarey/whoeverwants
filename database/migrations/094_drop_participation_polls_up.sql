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

-- 1. Delete every participation poll. ON DELETE CASCADE on votes.poll_id
--    and polls.parent_participation_poll_id_fkey takes care of votes and
--    location/time sub-polls. Pre-Phase-4 participation polls have no
--    multipoll_id, so this leaves multipolls / non-participation polls
--    untouched. Sub-polls (is_sub_poll = true) are also cleaned up here in
--    case any orphaned ones exist outside the FK relationship.
DELETE FROM polls WHERE poll_type = 'participation';
DELETE FROM polls WHERE is_sub_poll = true;

-- 2. Drop participation-only CHECK constraints + indexes on `polls`.
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_min_participants_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_participants_range_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_location_mode_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_time_mode_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_sub_poll_role_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_parent_participation_poll_id_fkey;
DROP INDEX IF EXISTS idx_polls_parent_participation;

-- 3. Drop participation-only columns on `polls`. Reference location fields
--    (reference_latitude/longitude/label), day_time_windows, duration_window,
--    and min_availability_percent are kept — time polls use them.
ALTER TABLE polls DROP COLUMN IF EXISTS min_participants;
ALTER TABLE polls DROP COLUMN IF EXISTS max_participants;
ALTER TABLE polls DROP COLUMN IF EXISTS location_mode;
ALTER TABLE polls DROP COLUMN IF EXISTS location_value;
ALTER TABLE polls DROP COLUMN IF EXISTS location_options;
ALTER TABLE polls DROP COLUMN IF EXISTS resolved_location;
ALTER TABLE polls DROP COLUMN IF EXISTS time_mode;
ALTER TABLE polls DROP COLUMN IF EXISTS time_value;
ALTER TABLE polls DROP COLUMN IF EXISTS time_options;
ALTER TABLE polls DROP COLUMN IF EXISTS resolved_time;
ALTER TABLE polls DROP COLUMN IF EXISTS is_sub_poll;
ALTER TABLE polls DROP COLUMN IF EXISTS sub_poll_role;
ALTER TABLE polls DROP COLUMN IF EXISTS parent_participation_poll_id;
ALTER TABLE polls DROP COLUMN IF EXISTS location_suggestions_deadline_minutes;
ALTER TABLE polls DROP COLUMN IF EXISTS location_preferences_deadline_minutes;
ALTER TABLE polls DROP COLUMN IF EXISTS time_suggestions_deadline_minutes;
ALTER TABLE polls DROP COLUMN IF EXISTS time_preferences_deadline_minutes;

-- 4. Drop participation-only columns + constraints on `votes`.
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_min_participants_check;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_max_min_participants_check;
ALTER TABLE votes DROP COLUMN IF EXISTS min_participants;
ALTER TABLE votes DROP COLUMN IF EXISTS max_participants;

-- 5. Recreate the poll_type / vote_type CHECK constraints without
--    'participation'. (These were dropped in earlier migration churn on prod
--    but may still exist on dev/test envs — DROP IF EXISTS is defensive.)
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
  CHECK (poll_type IN ('yes_no', 'ranked_choice', 'time'));

ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
  CHECK (vote_type IN ('yes_no', 'ranked_choice', 'time'));

-- 6. Recreate vote_structure_valid without the participation branch.
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_structure_valid;
ALTER TABLE votes ADD CONSTRAINT vote_structure_valid CHECK (
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
