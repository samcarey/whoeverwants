-- Add reference location columns for proximity-based location search
ALTER TABLE polls
    ADD COLUMN IF NOT EXISTS reference_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS reference_longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS reference_location_label TEXT;
