-- Add creator_secret column to polls table
ALTER TABLE polls ADD COLUMN creator_secret VARCHAR(64) NOT NULL DEFAULT gen_random_uuid()::text;

-- Create index for efficient lookups
CREATE INDEX idx_polls_creator_secret ON polls(creator_secret);

-- Update existing polls to have unique secrets
UPDATE polls SET creator_secret = gen_random_uuid()::text WHERE creator_secret = gen_random_uuid()::text;