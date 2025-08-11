-- Add sequential ID and short_id for shorter URLs
-- Migration: 021_add_sequential_id_and_short_id
-- Description: Adds a sequential numeric ID and base62 encoded short_id for shorter poll URLs

-- Add sequential ID column
ALTER TABLE polls ADD COLUMN sequential_id SERIAL UNIQUE;

-- Add short_id column for base62 encoded sequential IDs
ALTER TABLE polls ADD COLUMN short_id TEXT UNIQUE;

-- Create index on short_id for fast lookups
CREATE INDEX idx_polls_short_id ON polls(short_id);

-- Function to encode number to base62
CREATE OR REPLACE FUNCTION encode_base62(num BIGINT)
RETURNS TEXT AS $$
DECLARE
    chars TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    result TEXT := '';
    base INTEGER := 62;
    char_index INTEGER;
BEGIN
    IF num = 0 THEN
        RETURN '0';
    END IF;
    
    WHILE num > 0 LOOP
        char_index := (num % base) + 1;
        result := substring(chars FROM char_index FOR 1) || result;
        num := num / base;
    END LOOP;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to decode base62 to number
CREATE OR REPLACE FUNCTION decode_base62(encoded TEXT)
RETURNS BIGINT AS $$
DECLARE
    chars TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    result BIGINT := 0;
    base INTEGER := 62;
    i INTEGER;
    char_pos INTEGER;
    current_char TEXT;
BEGIN
    FOR i IN 1..length(encoded) LOOP
        current_char := substring(encoded FROM i FOR 1);
        char_pos := strpos(chars, current_char) - 1;
        IF char_pos = -1 THEN
            RAISE EXCEPTION 'Invalid base62 character: %', current_char;
        END IF;
        result := result * base + char_pos;
    END LOOP;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to generate short_id from sequential_id
CREATE OR REPLACE FUNCTION generate_short_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
        NEW.short_id := encode_base62(NEW.sequential_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically generate short_id
CREATE TRIGGER trigger_generate_short_id
    BEFORE INSERT OR UPDATE ON polls
    FOR EACH ROW
    EXECUTE FUNCTION generate_short_id();

-- Update existing polls with sequential_id and short_id
-- (This will assign sequential IDs to existing polls in order of creation)
DO $$
DECLARE
    poll_record RECORD;
    counter INTEGER := 1;
BEGIN
    FOR poll_record IN 
        SELECT id FROM polls ORDER BY created_at, id
    LOOP
        UPDATE polls 
        SET sequential_id = counter,
            short_id = encode_base62(counter)
        WHERE id = poll_record.id;
        
        counter := counter + 1;
    END LOOP;
END $$;

-- Update the sequence to continue from the last assigned sequential_id
SELECT setval('polls_sequential_id_seq', COALESCE((SELECT MAX(sequential_id) FROM polls), 0) + 1, false);