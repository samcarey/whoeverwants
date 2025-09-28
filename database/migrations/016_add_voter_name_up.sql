-- Add voter_name column to votes table for optional voter identification
ALTER TABLE votes ADD COLUMN IF NOT EXISTS voter_name TEXT;