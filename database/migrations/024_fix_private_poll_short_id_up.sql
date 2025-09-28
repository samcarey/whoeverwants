-- Fix private poll short_id generation
-- The generate_short_id trigger was overriding the private poll logic
-- Update it to respect the is_private field

-- Update the generate_short_id function to respect is_private setting
CREATE OR REPLACE FUNCTION generate_short_id()
RETURNS TRIGGER AS $$
BEGIN
    -- Only generate short_id if the poll is not private
    IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL AND NEW.is_private = false THEN
        NEW.short_id := encode_base62(NEW.sequential_id);
    ELSIF NEW.is_private = true THEN
        -- For private polls, ensure short_id is NULL
        NEW.short_id := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remove the redundant set_short_id trigger and function since we're using generate_short_id
DROP TRIGGER IF EXISTS set_short_id_trigger ON polls;
DROP FUNCTION IF EXISTS set_short_id();

-- Clean up any existing private polls that have short_ids
UPDATE polls SET short_id = NULL WHERE is_private = true;