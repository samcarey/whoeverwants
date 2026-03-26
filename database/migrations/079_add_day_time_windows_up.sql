-- Add day_time_windows column to support different time windows per day
-- New structure: [{"day": "2025-01-15", "windows": [{"min": "09:00", "max": "12:00"}, ...]}]

-- Add new column
ALTER TABLE polls
ADD COLUMN IF NOT EXISTS day_time_windows JSONB;

-- Migrate existing data from possible_days + time_window to day_time_windows
UPDATE polls
SET day_time_windows = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'day', day,
      'windows', CASE
        WHEN time_window IS NOT NULL
             AND (time_window->>'minEnabled')::boolean = true
             AND (time_window->>'maxEnabled')::boolean = true
        THEN jsonb_build_array(
          jsonb_build_object(
            'min', time_window->>'minValue',
            'max', time_window->>'maxValue'
          )
        )
        ELSE jsonb_build_array()
      END
    )
  )
  FROM unnest(possible_days) AS day
)
WHERE poll_type = 'participation'
  AND possible_days IS NOT NULL
  AND array_length(possible_days, 1) > 0
  AND day_time_windows IS NULL;

-- Add comment
COMMENT ON COLUMN polls.day_time_windows IS 'JSONB array of per-day time windows: [{"day": "YYYY-MM-DD", "windows": [{"min": "HH:MM", "max": "HH:MM"}]}]. Replaces possible_days + time_window for more flexible scheduling.';

-- Note: possible_days and time_window columns kept for backwards compatibility during transition
-- They will be deprecated in a future migration once all code is updated
