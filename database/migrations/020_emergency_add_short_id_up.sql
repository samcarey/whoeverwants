-- Emergency fix: Add short_id field and related components
-- This is a simplified version of the short_id migration to fix poll creation

-- Add short_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'polls' AND column_name = 'short_id') THEN
        ALTER TABLE polls ADD COLUMN short_id TEXT UNIQUE;
        CREATE INDEX IF NOT EXISTS idx_polls_short_id ON polls(short_id);
    END IF;
END $$;

-- Add sequential_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'polls' AND column_name = 'sequential_id') THEN
        ALTER TABLE polls ADD COLUMN sequential_id SERIAL UNIQUE;
    END IF;
END $$;

-- Create base62 encoding function if it doesn't exist
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

-- Create trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION generate_short_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
        NEW.short_id := encode_base62(NEW.sequential_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists to avoid conflicts
DROP TRIGGER IF EXISTS trigger_generate_short_id ON polls;

-- Create the trigger
CREATE TRIGGER trigger_generate_short_id
    BEFORE INSERT OR UPDATE ON polls
    FOR EACH ROW
    EXECUTE FUNCTION generate_short_id();