-- Add fields to store participation poll conditions
-- These define the universe of possible conditions that voters can select from

-- Add possible_days column (array of day names: Monday, Tuesday, etc.)
ALTER TABLE polls
ADD COLUMN IF NOT EXISTS possible_days TEXT[];

-- Add duration_window column (stores min/max duration values and enabled flags)
-- Structure: { minValue: number, maxValue: number, minEnabled: boolean, maxEnabled: boolean }
ALTER TABLE polls
ADD COLUMN IF NOT EXISTS duration_window JSONB;

-- Add time_window column (stores min/max time values and enabled flags)
-- Structure: { minValue: string (HH:MM), maxValue: string (HH:MM), minEnabled: boolean, maxEnabled: boolean }
ALTER TABLE polls
ADD COLUMN IF NOT EXISTS time_window JSONB;

-- Add comments to document the structure
COMMENT ON COLUMN polls.possible_days IS 'Array of day names that voters can select from for participation polls';
COMMENT ON COLUMN polls.duration_window IS 'JSONB object defining the duration constraints: {minValue, maxValue, minEnabled, maxEnabled}';
COMMENT ON COLUMN polls.time_window IS 'JSONB object defining the time window constraints: {minValue, maxValue, minEnabled, maxEnabled}';
