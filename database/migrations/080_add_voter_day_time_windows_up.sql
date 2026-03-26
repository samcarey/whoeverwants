-- Add voter_day_time_windows column to votes table
-- New structure: [{"day": "2025-01-15", "windows": [{"min": "09:00", "max": "12:00"}, ...]}]

-- Add new column
ALTER TABLE votes
ADD COLUMN IF NOT EXISTS voter_day_time_windows JSONB;

-- Add comment
COMMENT ON COLUMN votes.voter_day_time_windows IS 'JSONB array of per-day time windows for voter: [{"day": "YYYY-MM-DD", "windows": [{"min": "HH:MM", "max": "HH:MM"}]}]. Replaces voter_days + voter_time for more flexible scheduling.';

-- Note: voter_days and voter_time columns kept for backwards compatibility during transition
-- They will be deprecated in a future migration once all code is updated
