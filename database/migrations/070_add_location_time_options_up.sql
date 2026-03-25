-- Add options columns for 'preferences' mode (creator-provided options)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location_options TEXT[];
ALTER TABLE polls ADD COLUMN IF NOT EXISTS time_options TEXT[];
