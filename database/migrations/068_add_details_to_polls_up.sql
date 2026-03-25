-- Add optional details field to polls
ALTER TABLE polls ADD COLUMN IF NOT EXISTS details TEXT;
