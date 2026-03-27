ALTER TABLE polls
    DROP COLUMN IF EXISTS reference_latitude,
    DROP COLUMN IF EXISTS reference_longitude,
    DROP COLUMN IF EXISTS reference_location_label;
