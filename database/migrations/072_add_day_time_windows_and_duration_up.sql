-- Add day_time_windows and duration_window columns to polls table
-- day_time_windows: JSONB array of {day: "YYYY-MM-DD", windows: [{min: "HH:MM", max: "HH:MM"}]}
-- duration_window: JSONB object {minValue, maxValue, minEnabled, maxEnabled}
ALTER TABLE polls ADD COLUMN IF NOT EXISTS day_time_windows JSONB;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS duration_window JSONB;

-- Add voter-specific columns to votes table
-- voter_day_time_windows: voter's selected subset of the poll's day_time_windows
-- voter_duration: voter's duration preferences
ALTER TABLE votes ADD COLUMN IF NOT EXISTS voter_day_time_windows JSONB;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS voter_duration JSONB;
