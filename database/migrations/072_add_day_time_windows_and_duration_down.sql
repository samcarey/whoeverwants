-- Remove day_time_windows and duration columns
ALTER TABLE votes DROP COLUMN IF EXISTS voter_duration;
ALTER TABLE votes DROP COLUMN IF EXISTS voter_day_time_windows;
ALTER TABLE polls DROP COLUMN IF EXISTS duration_window;
ALTER TABLE polls DROP COLUMN IF EXISTS day_time_windows;
