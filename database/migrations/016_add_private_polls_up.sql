-- Add is_private column to polls table with default true
-- This makes polls private by default, requiring the full UUID to access

-- Add the is_private column
ALTER TABLE polls ADD COLUMN is_private BOOLEAN DEFAULT true;

-- Update existing polls to be public (maintain current behavior)
UPDATE polls SET is_private = false WHERE is_private IS NULL;

-- Make the column NOT NULL after setting defaults
ALTER TABLE polls ALTER COLUMN is_private SET NOT NULL;

-- Update the short_id generation trigger to only generate for public polls
-- First, let's see the existing trigger and replace it

-- Drop the existing trigger and function
DROP TRIGGER IF EXISTS set_short_id_trigger ON polls;
DROP FUNCTION IF EXISTS set_short_id();

-- Create updated function that only generates short_id for public polls
CREATE OR REPLACE FUNCTION set_short_id()
RETURNS TRIGGER AS $$
BEGIN
    -- Only generate short_id if the poll is not private
    IF NEW.is_private = false AND NEW.short_id IS NULL THEN
        -- Generate a random 6-character short ID
        NEW.short_id := (
            SELECT string_agg(
                CASE 
                    WHEN random() < 0.5 THEN chr(ascii('a') + floor(random() * 26)::int)
                    ELSE chr(ascii('0') + floor(random() * 10)::int)
                END,
                ''
            )
            FROM generate_series(1, 6)
        );
        
        -- Ensure uniqueness (retry up to 10 times if collision)
        DECLARE
            attempts INT := 0;
        BEGIN
            WHILE EXISTS (SELECT 1 FROM polls WHERE short_id = NEW.short_id) AND attempts < 10 LOOP
                NEW.short_id := (
                    SELECT string_agg(
                        CASE 
                            WHEN random() < 0.5 THEN chr(ascii('a') + floor(random() * 26)::int)
                            ELSE chr(ascii('0') + floor(random() * 10)::int)
                        END,
                        ''
                    )
                    FROM generate_series(1, 6)
                );
                attempts := attempts + 1;
            END LOOP;
        END;
    ELSE
        -- For private polls, ensure short_id is NULL
        IF NEW.is_private = true THEN
            NEW.short_id := NULL;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER set_short_id_trigger
    BEFORE INSERT OR UPDATE ON polls
    FOR EACH ROW
    EXECUTE FUNCTION set_short_id();