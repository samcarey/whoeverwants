-- Add location/time fields for participation polls
-- Mode selection for each field
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_mode TEXT CHECK (location_mode IN ('set', 'preferences', 'suggestions'));
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_mode TEXT CHECK (time_mode IN ('set', 'preferences', 'suggestions'));

-- Static values for 'set' mode
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_value TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_value TEXT;

-- Resolved values (populated when sub-poll chain completes)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS resolved_location TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS resolved_time TEXT;

-- Sub-poll metadata
ALTER TABLE polls ADD COLUMN IF NOT EXISTS is_sub_poll BOOLEAN DEFAULT false;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS sub_poll_role TEXT CHECK (sub_poll_role IN (
  'location_preferences', 'location_suggestions',
  'time_preferences', 'time_suggestions'
));
ALTER TABLE polls ADD COLUMN IF NOT EXISTS parent_participation_poll_id UUID REFERENCES polls(id);

-- Phase deadlines (in minutes)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_suggestions_deadline_minutes INT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_preferences_deadline_minutes INT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_suggestions_deadline_minutes INT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_preferences_deadline_minutes INT;
