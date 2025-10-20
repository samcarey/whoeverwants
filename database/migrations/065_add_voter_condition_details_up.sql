-- Add detailed voter conditions to votes table (days, duration, time)
-- These store each voter's specific conditions as a subset of the poll's possible conditions

-- Add voter_days column (array of selected day names)
ALTER TABLE votes
ADD COLUMN IF NOT EXISTS voter_days TEXT[];

-- Add voter_duration column (stores min/max duration values and enabled flags)
-- Structure: { minValue: number, maxValue: number, minEnabled: boolean, maxEnabled: boolean }
ALTER TABLE votes
ADD COLUMN IF NOT EXISTS voter_duration JSONB;

-- Add voter_time column (stores min/max time values and enabled flags)
-- Structure: { minValue: string (HH:MM), maxValue: string (HH:MM), minEnabled: boolean, maxEnabled: boolean }
ALTER TABLE votes
ADD COLUMN IF NOT EXISTS voter_time JSONB;

-- Add comments to document the structure
COMMENT ON COLUMN votes.voter_days IS 'Array of day names selected by voter (must be subset of poll.possible_days)';
COMMENT ON COLUMN votes.voter_duration IS 'JSONB object with voter duration constraints: {minValue, maxValue, minEnabled, maxEnabled}';
COMMENT ON COLUMN votes.voter_time IS 'JSONB object with voter time window constraints: {minValue, maxValue, minEnabled, maxEnabled}';
