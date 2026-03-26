-- Remove location/time fields from polls
ALTER TABLE polls DROP COLUMN IF EXISTS time_preferences_deadline_minutes;
ALTER TABLE polls DROP COLUMN IF EXISTS time_suggestions_deadline_minutes;
ALTER TABLE polls DROP COLUMN IF EXISTS location_preferences_deadline_minutes;
ALTER TABLE polls DROP COLUMN IF EXISTS location_suggestions_deadline_minutes;
ALTER TABLE polls DROP COLUMN IF EXISTS parent_participation_poll_id;
ALTER TABLE polls DROP COLUMN IF EXISTS sub_poll_role;
ALTER TABLE polls DROP COLUMN IF EXISTS is_sub_poll;
ALTER TABLE polls DROP COLUMN IF EXISTS resolved_time;
ALTER TABLE polls DROP COLUMN IF EXISTS resolved_location;
ALTER TABLE polls DROP COLUMN IF EXISTS time_value;
ALTER TABLE polls DROP COLUMN IF EXISTS location_value;
ALTER TABLE polls DROP COLUMN IF EXISTS time_mode;
ALTER TABLE polls DROP COLUMN IF EXISTS location_mode;
