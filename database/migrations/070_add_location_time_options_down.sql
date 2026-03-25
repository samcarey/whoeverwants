-- Remove location/time options columns
ALTER TABLE polls DROP COLUMN IF EXISTS time_options;
ALTER TABLE polls DROP COLUMN IF EXISTS location_options;
